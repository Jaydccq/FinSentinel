package com.example.finsentinel.agent.tool;

import com.example.finsentinel.config.PolygonProperties;
import com.example.finsentinel.service.rag.RagRetrievalService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

@Component
@Slf4j
@RequiredArgsConstructor
public class NewsAnalysisTool {

    private final RestClient restClient;
    private final PolygonProperties polygonProperties;
    private final RagRetrievalService ragRetrievalService;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    @Tool(description = "Fetch recent financial news articles for a stock ticker from Polygon.io. " +
            "Returns article titles, descriptions, authors, and publish dates. " +
            "Use this to understand current market sentiment and recent events for a stock.")
    public String getRecentNews(
            @ToolParam(description = "Stock ticker symbol, e.g. AAPL") String ticker,
            @ToolParam(description = "Number of days back to search (1-30)") int days) {
        ticker = ticker.toUpperCase().trim();
        days = Math.min(Math.max(days, 1), 30);

        String cacheKey = "news:" + ticker + ":" + days;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return cached;
        }

        try {
            String publishedAfter = LocalDate.now().minusDays(days)
                    .format(DateTimeFormatter.ISO_LOCAL_DATE);

            JsonNode response = restClient.get()
                    .uri(polygonProperties.getBaseUrl() +
                                    "/v2/reference/news?ticker={ticker}&published_utc.gte={date}&limit=10&apiKey={apiKey}",
                            ticker, publishedAfter, polygonProperties.getApiKey())
                    .retrieve()
                    .body(JsonNode.class);

            if (response == null || !response.has("results") || response.get("results").isEmpty()) {
                return "No recent news found for " + ticker + " in the last " + days + " days.";
            }

            StringBuilder sb = new StringBuilder();
            sb.append("Recent news for ").append(ticker).append(" (last ").append(days).append(" days):\n\n");
            int count = 0;
            for (JsonNode article : response.get("results")) {
                count++;
                sb.append(count).append(". **").append(article.path("title").asText("Untitled")).append("**\n");
                sb.append("   Author: ").append(article.path("author").asText("Unknown")).append("\n");
                sb.append("   Published: ").append(article.path("published_utc").asText("")).append("\n");
                sb.append("   Summary: ").append(article.path("description").asText("No description")).append("\n\n");
            }

            String result = sb.toString();
            redisTemplate.opsForValue().set(cacheKey, result, Duration.ofMinutes(15));
            return result;

        } catch (Exception e) {
            log.error("Failed to fetch news for {}", ticker, e);
            return "Error fetching news for " + ticker + ": " + e.getMessage();
        }
    }

    @Tool(description = "Search the RAG knowledge base for relevant financial documents. " +
            "Searches through SEC filings, research reports, regulations, and news stored in the vector database. " +
            "Use this to find in-depth analysis, regulatory context, or historical research on a topic.")
    public String searchKnowledgeBase(
            @ToolParam(description = "Search query, e.g. 'Apple revenue trends' or 'SEC insider trading regulations'") String query,
            @ToolParam(description = "Document type filter: SEC_FILING, RESEARCH_REPORT, NEWS, REGULATION, or null for all") String docType) {

        if (docType != null && docType.equalsIgnoreCase("null")) {
            docType = null;
        }

        List<Document> results = ragRetrievalService.search(query, 5, docType, null, null);

        if (results.isEmpty()) {
            return "No relevant documents found in knowledge base for: " + query;
        }

        StringBuilder sb = new StringBuilder();
        sb.append("Knowledge base results for '").append(query).append("':\n\n");
        for (int i = 0; i < results.size(); i++) {
            Document doc = results.get(i);
            sb.append(i + 1).append(". ");
            if (doc.getMetadata().containsKey("source")) {
                sb.append("[Source: ").append(doc.getMetadata().get("source")).append("] ");
            }
            if (doc.getMetadata().containsKey("doc_type")) {
                sb.append("[Type: ").append(doc.getMetadata().get("doc_type")).append("] ");
            }
            sb.append("\n");
            String content = doc.getText();
            if (content.length() > 500) {
                content = content.substring(0, 500) + "...";
            }
            sb.append("   ").append(content).append("\n\n");
        }

        return sb.toString();
    }
}
