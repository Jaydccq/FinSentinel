package com.example.finsentinel.service.news;

import com.example.finsentinel.config.CryptoNewsProperties;
import com.example.finsentinel.model.enums.NewsSource;
import tools.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "app.crypto-news.enabled", havingValue = "true")
public class CryptoNewsFetcher implements NewsFetcher {

    private final CryptoNewsApiClient apiClient;
    private final CryptoNewsProperties properties;

    @Override
    public NewsSource getSource() {
        return NewsSource.CRYPTO_6551;
    }

    @Override
    public List<RawNewsItem> fetch(List<String> tickers) {
        List<RawNewsItem> results = new ArrayList<>();
        try {
            JsonNode response = apiClient.searchNews(
                    properties.getWatchCoins(), null,
                    Map.of("news", List.of()),
                    false, properties.getMaxResultsPerFetch(), 1);

            if (response == null || !response.has("data")) return results;

            int minScore = properties.getMinAiScore();
            for (JsonNode article : response.get("data")) {
                JsonNode aiRating = article.get("aiRating");
                int score = (aiRating != null && aiRating.has("score"))
                        ? aiRating.get("score").asInt(0) : 0;
                if (score < minScore) continue;

                RawNewsItem item = parseArticle(article, aiRating);
                if (item != null) results.add(item);
            }
            log.info("6551 fetched {} high-score articles (score >= {})", results.size(), minScore);
        } catch (Exception e) {
            log.error("Failed to fetch 6551 crypto news", e);
        }
        return results;
    }

    private RawNewsItem parseArticle(JsonNode article, JsonNode aiRating) {
        try {
            String id = article.has("id") ? article.get("id").asText() : null;
            if (id == null || id.isBlank()) return null;

            String enSummary = (aiRating != null && aiRating.has("enSummary"))
                    ? aiRating.get("enSummary").asText("") : "";
            String rawText = article.has("text") ? article.get("text").asText("")
                    .replaceAll("<[^>]+>", "").trim() : "";
            String title = !enSummary.isBlank() ? enSummary : rawText;
            if (title.length() > 200) title = title.substring(0, 200);

            String zhSummary = (aiRating != null && aiRating.has("summary"))
                    ? aiRating.get("summary").asText("") : "";
            String signal = (aiRating != null && aiRating.has("signal"))
                    ? aiRating.get("signal").asText("neutral") : "neutral";
            int score = (aiRating != null) ? aiRating.get("score").asInt(0) : 0;

            String articleUrl = article.has("link") ? article.get("link").asText("") : "";
            String newsType = article.has("newsType") ? article.get("newsType").asText("") : "";

            long ts = article.has("ts") ? article.get("ts").asLong(0) : 0;
            Instant publishedAt = ts > 0 ? Instant.ofEpochMilli(ts) : Instant.now();

            List<String> coins = new ArrayList<>();
            if (article.has("coins") && article.get("coins").isArray()) {
                for (JsonNode coin : article.get("coins")) {
                    if (coin.has("symbol")) coins.add(coin.get("symbol").asText());
                }
            }

            List<String> tags = new ArrayList<>();
            tags.add("source:" + newsType);
            tags.add("signal:" + signal);
            tags.add("score:" + score);
            if (!zhSummary.isBlank()) tags.add("zh:" + zhSummary);

            return new RawNewsItem(id, NewsSource.CRYPTO_6551, title,
                    zhSummary.isBlank() ? rawText : zhSummary,
                    articleUrl, newsType, publishedAt, coins, tags);
        } catch (Exception e) {
            log.warn("Failed to parse 6551 article", e);
            return null;
        }
    }
}
