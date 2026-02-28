package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.news.CryptoNewsApiClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Provides AI agent tools for real-time crypto news retrieval and signal filtering.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */
@Component
@Slf4j
@RequiredArgsConstructor
@ConditionalOnProperty(name = "app.crypto-news.enabled", havingValue = "true")
public class CryptoNewsTool {

    private final CryptoNewsApiClient apiClient;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    @Tool(description = "Search real-time crypto news articles from the 6551 API. " +
            "Returns articles with AI-generated scores, grades, trading signals, and summaries. " +
            "Use this to understand current crypto market sentiment and breaking news for a coin or topic.")
    public String getCryptoNews(
            @ToolParam(description = "Search keyword, e.g. 'bitcoin ETF' or 'ethereum merge'") String keyword,
            @ToolParam(description = "Coin symbol filter, e.g. 'BTC' or 'ETH', or null for all coins") String coin,
            @ToolParam(description = "Minimum AI rating score (0-100) to filter low-quality articles") int minScore,
            @ToolParam(description = "Number of articles to return (1-20)") int limit) {

        limit = Math.min(Math.max(limit, 1), 20);
        minScore = Math.min(Math.max(minScore, 0), 100);
        if (keyword != null) keyword = keyword.trim();
        if (coin != null) coin = coin.toUpperCase().trim();

        String cacheKey = "crypto_news:" + keyword + ":" + coin + ":" + minScore + ":" + limit;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return cached;
        }

        try {
            int fetchLimit = Math.min(limit * 3, 30);
            List<String> coins = (coin != null && !coin.isBlank()) ? List.of(coin) : null;

            JsonNode response = apiClient.searchNews(
                    coins, keyword,
                    Map.of("news", List.of()),
                    coin != null && !coin.isBlank(),
                    fetchLimit, 1);

            if (response == null || !response.has("data") || response.get("data").isEmpty()) {
                return "No crypto news found for keyword='" + keyword + "', coin=" + coin;
            }

            StringBuilder sb = new StringBuilder();
            sb.append("Crypto news results");
            if (keyword != null && !keyword.isBlank()) sb.append(" for '").append(keyword).append("'");
            if (coin != null && !coin.isBlank()) sb.append(" [").append(coin).append("]");
            sb.append(":\n\n");

            int count = 0;
            for (JsonNode article : response.get("data")) {
                JsonNode aiRating = article.path("aiRating");
                int score = aiRating.path("score").asInt(0);
                if (score < minScore) continue;
                if (count >= limit) break;
                count++;

                String title = article.path("title").asText("Untitled");
                String source = article.path("source").asText("Unknown");
                String grade = aiRating.path("grade").asText("N/A");
                String signal = aiRating.path("signal").asText("N/A");
                String summary = aiRating.path("enSummary").asText("");
                String text = article.path("text").asText("");
                text = text.replaceAll("<[^>]+>", "").trim();

                sb.append(count).append(". **").append(title).append("**\n");
                sb.append("   Score: ").append(score).append("/100 | Grade: ").append(grade);
                sb.append(" | Signal: ").append(signal).append("\n");
                sb.append("   Source: ").append(source).append("\n");

                JsonNode coinArr = article.path("coins");
                if (coinArr.isArray() && !coinArr.isEmpty()) {
                    sb.append("   Coins: ");
                    for (int i = 0; i < coinArr.size(); i++) {
                        if (i > 0) sb.append(", ");
                        sb.append(coinArr.get(i).path("symbol").asText());
                    }
                    sb.append("\n");
                }

                if (!summary.isBlank()) {
                    sb.append("   Summary: ").append(summary).append("\n");
                } else if (!text.isBlank()) {
                    String snippet = text.length() > 300 ? text.substring(0, 300) + "..." : text;
                    sb.append("   Snippet: ").append(snippet).append("\n");
                }
                sb.append("\n");
            }

            if (count == 0) {
                return "No crypto news articles found with score >= " + minScore
                        + " for keyword='" + keyword + "', coin=" + coin;
            }

            String result = sb.toString();
            redisTemplate.opsForValue().set(cacheKey, result, Duration.ofMinutes(10));
            return result;

        } catch (Exception e) {
            log.error("Failed to fetch crypto news for keyword={}, coin={}", keyword, coin, e);
            return "Error fetching crypto news: " + e.getMessage();
        }
    }

    @Tool(description = "Get crypto news articles filtered by AI-generated trading signal (long, short, or neutral). " +
            "Returns only articles where AI analysis is complete and matches the requested signal. " +
            "Use this to find news supporting a specific market direction thesis.")
    public String getCryptoNewsBySignal(
            @ToolParam(description = "Trading signal filter: 'long', 'short', or 'neutral'") String signal,
            @ToolParam(description = "Number of articles to return (1-10)") int limit) {

        limit = Math.min(Math.max(limit, 1), 10);
        if (signal != null) signal = signal.toLowerCase().trim();

        String cacheKey = "crypto_news:signal:" + signal + ":" + limit;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return cached;
        }

        try {
            int fetchLimit = Math.min(limit * 3, 30);

            JsonNode response = apiClient.searchNews(
                    null, null,
                    Map.of("news", List.of()),
                    false, fetchLimit, 1);

            if (response == null || !response.has("data") || response.get("data").isEmpty()) {
                return "No crypto news found for signal='" + signal + "'";
            }

            StringBuilder sb = new StringBuilder();
            sb.append("Crypto news with **").append(signal).append("** signal:\n\n");

            int count = 0;
            for (JsonNode article : response.get("data")) {
                JsonNode aiRating = article.path("aiRating");
                String articleSignal = aiRating.path("signal").asText("");
                String status = aiRating.path("status").asText("");

                if (!"done".equalsIgnoreCase(status)) continue;
                if (!signal.equalsIgnoreCase(articleSignal)) continue;
                if (count >= limit) break;
                count++;

                String title = article.path("title").asText("Untitled");
                int score = aiRating.path("score").asInt(0);
                String summary = aiRating.path("enSummary").asText("");

                sb.append(count).append(". **").append(title).append("**\n");
                sb.append("   Score: ").append(score).append("/100 | Signal: ").append(articleSignal).append("\n");

                if (!summary.isBlank()) {
                    sb.append("   Summary: ").append(summary).append("\n");
                }
                sb.append("\n");
            }

            if (count == 0) {
                return "No crypto news articles found with signal='" + signal + "' (status=done)";
            }

            String result = sb.toString();
            redisTemplate.opsForValue().set(cacheKey, result, Duration.ofMinutes(10));
            return result;

        } catch (Exception e) {
            log.error("Failed to fetch crypto news by signal={}", signal, e);
            return "Error fetching crypto news by signal: " + e.getMessage();
        }
    }
}
