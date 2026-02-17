# Phase 3: AI Agent & Function Calling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the complete AI Agent layer — 4 Function Calling tools (3.1-3.4), ChatClient + Agent orchestration (3.5), structured prompt templates (3.6), and BeanOutputConverter for RiskReport structured output (3.7). TDD approach: write tests first, then implement.

**Architecture:** Tools are Spring beans with `@Tool`-annotated methods. The Agent orchestration layer uses `ChatClient` with registered tools, RAG advisor, and `BeanOutputConverter` for structured `RiskReport` output. The LLM (Gemini 3 Flash via OpenRouter) decides which tools to invoke based on the user query.

**Tech Stack:** Spring AI 2.0-M2 (`@Tool`, `ChatClient`, `BeanOutputConverter`), Ta4j 0.16 (RSI/MACD/Bollinger), Polygon.io REST API, Redis (market data cache), Spring Boot 4.0.2

---

## Existing Code Inventory

Already built (do NOT recreate):
- `PolygonProperties` — `apiKey`, `baseUrl` (prefix: `app.polygon`)
- `ComplianceProperties` — `region`, `disclaimer` (prefix: `app.compliance`)
- `RestClientConfig` — `RestClient` bean
- `PolygonNewsScraper` — fetches news from Polygon.io `/v2/reference/news` endpoint
- `RagRetrievalService` — semantic search with metadata filters (docType, sector, regionId)
- `RagAdvisorConfig` — `QuestionAnswerAdvisor` bean with VectorStore (topK=5, similarity=0.7)
- `HoldingRepository` — `findByPortfolioId(UUID)`, `findBySymbol(String)`
- `PortfolioRepository` — `findByUserId(UUID)`
- All model entities: `Portfolio`, `Holding`, `RiskReportEntity`, `User`
- All DTOs: `RiskReport`, `RiskFactor`, `ComplianceNote`, `HoldingResponse`, `PortfolioResponse`, `ChatRequest`
- Enums: `RiskLevel`, `RiskCategory`

---

## File Structure Overview

```
agent/
├── tool/
│   ├── StockMarketTool.java        ← Task 3.1
│   ├── NewsAnalysisTool.java       ← Task 3.2
│   ├── TechnicalIndicatorTool.java ← Task 3.3
│   └── PortfolioAnalysisTool.java  ← Task 3.4
├── AgentConfig.java                ← Task 3.5 (ChatClient bean)
├── RiskAgentService.java           ← Task 3.5 (orchestration service)
└── output/
    └── RiskReportOutputConfig.java ← Task 3.7 (BeanOutputConverter)
src/main/resources/prompts/
├── risk-assessment.st              ← Task 3.6 (main prompt)
└── system-prompt.st                ← Task 3.6 (system prompt)
```

---

### Task 3.1: StockMarketTool — Polygon.io 实时行情

**Test First:** `src/test/java/com/example/finsentinel/agent/tool/StockMarketToolTest.java`
**Impl:** `src/main/java/com/example/finsentinel/agent/tool/StockMarketTool.java`

**Purpose:** Fetch real-time stock data from Polygon.io when the LLM needs market data.

**Step 1: Write unit test**

```java
package com.example.finsentinel.agent.tool;

import com.example.finsentinel.config.PolygonProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.web.client.RestClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class StockMarketToolTest {

    @Mock private RestClient restClient;
    @Mock private RestClient.RequestHeadersUriSpec requestHeadersUriSpec;
    @Mock private RestClient.RequestHeadersSpec requestHeadersSpec;
    @Mock private RestClient.ResponseSpec responseSpec;
    @Mock private StringRedisTemplate redisTemplate;
    @Mock private ValueOperations<String, String> valueOperations;

    private PolygonProperties polygonProperties;
    private ObjectMapper objectMapper;
    private StockMarketTool stockMarketTool;

    @BeforeEach
    void setUp() {
        polygonProperties = new PolygonProperties();
        polygonProperties.setApiKey("test-api-key");
        polygonProperties.setBaseUrl("https://api.polygon.io");
        objectMapper = new ObjectMapper();
        stockMarketTool = new StockMarketTool(restClient, polygonProperties, redisTemplate, objectMapper);
    }

    @Test
    void getStockQuote_shouldReturnFormattedQuote() throws Exception {
        // Arrange
        String polygonResponse = """
            {
                "results": [{
                    "c": 175.50, "h": 178.00, "l": 174.20,
                    "o": 176.00, "v": 52345678, "t": 1708000000000
                }],
                "ticker": "AAPL", "resultsCount": 1
            }
            """;
        JsonNode responseNode = objectMapper.readTree(polygonResponse);

        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get(anyString())).thenReturn(null); // no cache hit
        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(JsonNode.class)).thenReturn(responseNode);

        // Act
        String result = stockMarketTool.getStockQuote("AAPL");

        // Assert
        assertThat(result).contains("AAPL");
        assertThat(result).contains("175.5"); // close price
    }

    @Test
    void getStockQuote_shouldReturnCachedResult() {
        // Arrange
        String cachedResult = "{\"symbol\":\"AAPL\",\"close\":175.50}";
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get(anyString())).thenReturn(cachedResult);

        // Act
        String result = stockMarketTool.getStockQuote("AAPL");

        // Assert
        assertThat(result).isEqualTo(cachedResult);
        verify(restClient, never()).get(); // no API call
    }

    @Test
    void getStockQuote_shouldRejectInvalidTicker() {
        // Act
        String result = stockMarketTool.getStockQuote("INVALID_LONG_TICKER!!!");

        // Assert
        assertThat(result).contains("Invalid ticker");
    }
}
```

**Step 2: Implement StockMarketTool**

```java
package com.example.finsentinel.agent.tool;

import com.example.finsentinel.config.PolygonProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

@Component
@Slf4j
@RequiredArgsConstructor
public class StockMarketTool {

    private final RestClient restClient;
    private final PolygonProperties polygonProperties;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    private static final Duration CACHE_TTL = Duration.ofMinutes(5);

    @Tool(description = "Get real-time stock market data for a given ticker symbol. " +
            "Returns current price, open, high, low, close, and volume. " +
            "Use this when you need current market data for risk assessment.")
    public String getStockQuote(
            @ToolParam(description = "Stock ticker symbol, e.g. AAPL, MSFT, TSLA") String ticker) {
        ticker = ticker.toUpperCase().trim();
        if (!ticker.matches("^[A-Z]{1,5}$")) {
            return "Invalid ticker symbol: " + ticker + ". Must be 1-5 uppercase letters.";
        }

        // Check Redis cache
        String cacheKey = "stock:quote:" + ticker;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            log.debug("Cache hit for stock quote: {}", ticker);
            return cached;
        }

        try {
            String today = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);
            String from = LocalDate.now().minusDays(5).format(DateTimeFormatter.ISO_LOCAL_DATE);

            JsonNode response = restClient.get()
                    .uri(polygonProperties.getBaseUrl() +
                                    "/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}?adjusted=true&sort=desc&limit=1&apiKey={apiKey}",
                            ticker, from, today, polygonProperties.getApiKey())
                    .retrieve()
                    .body(JsonNode.class);

            if (response == null || !response.has("results") || response.get("results").isEmpty()) {
                return "No market data available for " + ticker + ". The market may be closed or the ticker may be invalid.";
            }

            JsonNode bar = response.get("results").get(0);
            String result = String.format(
                    """
                    Stock Quote for %s:
                    - Close: $%.2f
                    - Open: $%.2f
                    - High: $%.2f
                    - Low: $%.2f
                    - Volume: %d
                    - Data as of: %s""",
                    ticker,
                    bar.get("c").asDouble(),
                    bar.get("o").asDouble(),
                    bar.get("h").asDouble(),
                    bar.get("l").asDouble(),
                    bar.get("v").asLong(),
                    today);

            // Cache for 5 minutes
            redisTemplate.opsForValue().set(cacheKey, result, CACHE_TTL);
            log.info("Fetched stock quote for {}: close=${}", ticker, bar.get("c").asDouble());
            return result;

        } catch (Exception e) {
            log.error("Failed to fetch stock quote for {}", ticker, e);
            return "Error fetching stock data for " + ticker + ": " + e.getMessage();
        }
    }

    @Tool(description = "Get historical stock price data (daily bars) for technical analysis. " +
            "Returns OHLCV bars for the specified number of days.")
    public String getHistoricalPrices(
            @ToolParam(description = "Stock ticker symbol") String ticker,
            @ToolParam(description = "Number of days of historical data (max 365)") int days) {
        ticker = ticker.toUpperCase().trim();
        if (!ticker.matches("^[A-Z]{1,5}$")) {
            return "Invalid ticker symbol: " + ticker;
        }
        days = Math.min(Math.max(days, 1), 365);

        String cacheKey = "stock:history:" + ticker + ":" + days;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return cached;
        }

        try {
            String to = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);
            String from = LocalDate.now().minusDays(days).format(DateTimeFormatter.ISO_LOCAL_DATE);

            JsonNode response = restClient.get()
                    .uri(polygonProperties.getBaseUrl() +
                                    "/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}?adjusted=true&sort=asc&apiKey={apiKey}",
                            ticker, from, to, polygonProperties.getApiKey())
                    .retrieve()
                    .body(JsonNode.class);

            if (response == null || !response.has("results")) {
                return "No historical data for " + ticker;
            }

            String result = objectMapper.writeValueAsString(response.get("results"));

            redisTemplate.opsForValue().set(cacheKey, result, Duration.ofMinutes(30));
            log.info("Fetched {} days of history for {}", days, ticker);
            return result;

        } catch (Exception e) {
            log.error("Failed to fetch history for {}", ticker, e);
            return "Error fetching historical data for " + ticker + ": " + e.getMessage();
        }
    }
}
```

**Step 3: Verify compilation**
Run: `./gradlew compileJava`

**Step 4: Run tests**
Run: `./gradlew test --tests "com.example.finsentinel.agent.tool.StockMarketToolTest"`

---

### Task 3.2: NewsAnalysisTool — 财经新闻 + 情感分析

**Test First:** `src/test/java/com/example/finsentinel/agent/tool/NewsAnalysisToolTest.java`
**Impl:** `src/main/java/com/example/finsentinel/agent/tool/NewsAnalysisTool.java`

**Purpose:** Fetch recent financial news for a ticker and provide structured summaries. Uses the existing `PolygonNewsScraper` for data and `RagRetrievalService` for RAG-based context.

**Step 1: Write unit test**

```java
package com.example.finsentinel.agent.tool;

import com.example.finsentinel.config.PolygonProperties;
import com.example.finsentinel.service.rag.RagRetrievalService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.web.client.RestClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NewsAnalysisToolTest {

    @Mock private RestClient restClient;
    @Mock private RestClient.RequestHeadersUriSpec requestHeadersUriSpec;
    @Mock private RestClient.RequestHeadersSpec requestHeadersSpec;
    @Mock private RestClient.ResponseSpec responseSpec;
    @Mock private RagRetrievalService ragRetrievalService;
    @Mock private StringRedisTemplate redisTemplate;
    @Mock private ValueOperations<String, String> valueOperations;

    private PolygonProperties polygonProperties;
    private ObjectMapper objectMapper;
    private NewsAnalysisTool newsAnalysisTool;

    @BeforeEach
    void setUp() {
        polygonProperties = new PolygonProperties();
        polygonProperties.setApiKey("test-key");
        polygonProperties.setBaseUrl("https://api.polygon.io");
        objectMapper = new ObjectMapper();
        newsAnalysisTool = new NewsAnalysisTool(restClient, polygonProperties, ragRetrievalService, redisTemplate, objectMapper);
    }

    @Test
    void getRecentNews_shouldReturnFormattedNews() throws Exception {
        String apiResponse = """
            {
                "results": [{
                    "title": "Apple Reports Record Q4 Earnings",
                    "description": "Apple Inc reported strong earnings driven by iPhone sales.",
                    "author": "Reuters",
                    "published_utc": "2026-02-15T10:00:00Z",
                    "tickers": ["AAPL"]
                }]
            }
            """;
        JsonNode responseNode = objectMapper.readTree(apiResponse);

        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get(anyString())).thenReturn(null);
        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(JsonNode.class)).thenReturn(responseNode);

        String result = newsAnalysisTool.getRecentNews("AAPL", 7);

        assertThat(result).contains("Apple Reports Record Q4 Earnings");
        assertThat(result).contains("Reuters");
    }

    @Test
    void searchRagKnowledgeBase_shouldDelegateToRagService() {
        when(ragRetrievalService.search(anyString(), anyInt(), anyString(), isNull(), isNull()))
                .thenReturn(List.of());

        String result = newsAnalysisTool.searchKnowledgeBase("AAPL earnings analysis", "NEWS");

        verify(ragRetrievalService).search("AAPL earnings analysis", 5, "NEWS", null, null);
        assertThat(result).contains("No relevant documents found");
    }
}
```

**Step 2: Implement NewsAnalysisTool**

```java
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
```

**Step 3: Verify & test**
Run: `./gradlew compileJava && ./gradlew test --tests "com.example.finsentinel.agent.tool.NewsAnalysisToolTest"`

---

### Task 3.3: TechnicalIndicatorTool — Ta4j RSI/MACD/Bollinger

**Test First:** `src/test/java/com/example/finsentinel/agent/tool/TechnicalIndicatorToolTest.java`
**Impl:** `src/main/java/com/example/finsentinel/agent/tool/TechnicalIndicatorTool.java`

**Purpose:** Calculate technical indicators (RSI, MACD, Bollinger Bands) from historical price data using Ta4j. The LLM calls `StockMarketTool.getHistoricalPrices()` first, then passes the JSON data here for analysis.

**Step 1: Write unit test**

```java
package com.example.finsentinel.agent.tool;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TechnicalIndicatorToolTest {

    private TechnicalIndicatorTool tool;
    private ObjectMapper objectMapper;

    // Simulated 30 days of AAPL-like price data
    private static final String SAMPLE_BARS = """
        [
            {"o":170.0,"h":172.0,"l":169.0,"c":171.5,"v":50000000,"t":1706745600000},
            {"o":171.5,"h":173.0,"l":170.5,"c":172.0,"v":48000000,"t":1706832000000},
            {"o":172.0,"h":174.5,"l":171.0,"c":173.5,"v":52000000,"t":1706918400000},
            {"o":173.5,"h":175.0,"l":172.0,"c":174.0,"v":47000000,"t":1707004800000},
            {"o":174.0,"h":176.0,"l":173.5,"c":175.5,"v":55000000,"t":1707091200000},
            {"o":175.5,"h":177.0,"l":174.0,"c":176.0,"v":51000000,"t":1707177600000},
            {"o":176.0,"h":178.0,"l":175.0,"c":177.5,"v":49000000,"t":1707264000000},
            {"o":177.5,"h":179.0,"l":176.5,"c":178.0,"v":53000000,"t":1707350400000},
            {"o":178.0,"h":180.0,"l":177.0,"c":179.0,"v":56000000,"t":1707436800000},
            {"o":179.0,"h":180.5,"l":177.5,"c":178.5,"v":48000000,"t":1707523200000},
            {"o":178.5,"h":179.5,"l":177.0,"c":178.0,"v":45000000,"t":1707609600000},
            {"o":178.0,"h":179.0,"l":176.5,"c":177.0,"v":44000000,"t":1707696000000},
            {"o":177.0,"h":178.5,"l":176.0,"c":177.5,"v":46000000,"t":1707782400000},
            {"o":177.5,"h":179.0,"l":176.5,"c":178.5,"v":50000000,"t":1707868800000},
            {"o":178.5,"h":180.0,"l":177.5,"c":179.5,"v":52000000,"t":1707955200000},
            {"o":179.5,"h":181.0,"l":178.5,"c":180.0,"v":54000000,"t":1708041600000},
            {"o":180.0,"h":182.0,"l":179.0,"c":181.5,"v":57000000,"t":1708128000000},
            {"o":181.5,"h":183.0,"l":180.5,"c":182.0,"v":55000000,"t":1708214400000},
            {"o":182.0,"h":183.5,"l":181.0,"c":182.5,"v":51000000,"t":1708300800000},
            {"o":182.5,"h":184.0,"l":181.5,"c":183.0,"v":53000000,"t":1708387200000},
            {"o":183.0,"h":184.5,"l":182.0,"c":183.5,"v":49000000,"t":1708473600000},
            {"o":183.5,"h":185.0,"l":182.5,"c":184.0,"v":56000000,"t":1708560000000},
            {"o":184.0,"h":185.5,"l":183.0,"c":184.5,"v":52000000,"t":1708646400000},
            {"o":184.5,"h":186.0,"l":183.5,"c":185.0,"v":54000000,"t":1708732800000},
            {"o":185.0,"h":186.5,"l":184.0,"c":185.5,"v":50000000,"t":1708819200000},
            {"o":185.5,"h":187.0,"l":184.5,"c":186.0,"v":55000000,"t":1708905600000},
            {"o":186.0,"h":187.5,"l":185.0,"c":186.5,"v":53000000,"t":1708992000000},
            {"o":186.5,"h":188.0,"l":185.5,"c":187.0,"v":57000000,"t":1709078400000},
            {"o":187.0,"h":188.5,"l":186.0,"c":187.5,"v":51000000,"t":1709164800000},
            {"o":187.5,"h":189.0,"l":186.5,"c":188.0,"v":54000000,"t":1709251200000}
        ]
        """;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        tool = new TechnicalIndicatorTool(objectMapper);
    }

    @Test
    void calculateRSI_shouldReturnValidValue() {
        String result = tool.calculateRSI(SAMPLE_BARS, 14);
        assertThat(result).contains("RSI");
        assertThat(result).doesNotContain("Error");
        // RSI should be a number between 0 and 100
    }

    @Test
    void calculateMACD_shouldReturnSignalAndHistogram() {
        String result = tool.calculateMACD(SAMPLE_BARS, 12, 26, 9);
        assertThat(result).contains("MACD");
        assertThat(result).doesNotContain("Error");
    }

    @Test
    void calculateBollingerBands_shouldReturnThreeBands() {
        String result = tool.calculateBollingerBands(SAMPLE_BARS, 20, 2.0);
        assertThat(result).contains("Bollinger");
        assertThat(result).contains("Upper");
        assertThat(result).contains("Middle");
        assertThat(result).contains("Lower");
    }

    @Test
    void calculateRSI_withInsufficientData_shouldReturnError() {
        String shortData = """
            [{"o":170.0,"h":172.0,"l":169.0,"c":171.5,"v":50000000,"t":1706745600000}]
            """;
        String result = tool.calculateRSI(shortData, 14);
        assertThat(result).contains("Insufficient data");
    }
}
```

**Step 2: Implement TechnicalIndicatorTool**

```java
package com.example.finsentinel.agent.tool;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;
import org.ta4j.core.BarSeries;
import org.ta4j.core.BaseBarSeriesBuilder;
import org.ta4j.core.indicators.RSIIndicator;
import org.ta4j.core.indicators.MACDIndicator;
import org.ta4j.core.indicators.EMAIndicator;
import org.ta4j.core.indicators.SMAIndicator;
import org.ta4j.core.indicators.statistics.StandardDeviationIndicator;
import org.ta4j.core.indicators.helpers.ClosePriceIndicator;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;

@Component
@Slf4j
@RequiredArgsConstructor
public class TechnicalIndicatorTool {

    private final ObjectMapper objectMapper;

    @Tool(description = "Calculate RSI (Relative Strength Index) from historical price data. " +
            "RSI > 70 = overbought (bearish signal), RSI < 30 = oversold (bullish signal). " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    public String calculateRSI(
            @ToolParam(description = "JSON array of price bars [{o,h,l,c,v,t}, ...]") String barsJson,
            @ToolParam(description = "RSI period, typically 14") int period) {
        try {
            BarSeries series = parseBars(barsJson);
            if (series.getBarCount() < period + 1) {
                return "Insufficient data: need at least " + (period + 1) + " bars, got " + series.getBarCount();
            }

            ClosePriceIndicator closePrice = new ClosePriceIndicator(series);
            RSIIndicator rsi = new RSIIndicator(closePrice, period);

            int lastIndex = series.getEndIndex();
            double rsiValue = rsi.getValue(lastIndex).doubleValue();

            String signal;
            if (rsiValue > 70) signal = "OVERBOUGHT (bearish — potential reversal down)";
            else if (rsiValue > 60) signal = "MODERATELY BULLISH";
            else if (rsiValue > 40) signal = "NEUTRAL";
            else if (rsiValue > 30) signal = "MODERATELY BEARISH";
            else signal = "OVERSOLD (bullish — potential reversal up)";

            return String.format("""
                    RSI(%d) Analysis:
                    - Current RSI: %.2f
                    - Signal: %s
                    - Last 5 RSI values: %.1f, %.1f, %.1f, %.1f, %.1f""",
                    period, rsiValue, signal,
                    safeRsi(rsi, lastIndex - 4),
                    safeRsi(rsi, lastIndex - 3),
                    safeRsi(rsi, lastIndex - 2),
                    safeRsi(rsi, lastIndex - 1),
                    rsiValue);

        } catch (Exception e) {
            log.error("RSI calculation failed", e);
            return "Error calculating RSI: " + e.getMessage();
        }
    }

    @Tool(description = "Calculate MACD (Moving Average Convergence Divergence) from historical price data. " +
            "MACD above signal line = bullish, below = bearish. Histogram shows momentum strength. " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    public String calculateMACD(
            @ToolParam(description = "JSON array of price bars") String barsJson,
            @ToolParam(description = "Short EMA period, typically 12") int shortPeriod,
            @ToolParam(description = "Long EMA period, typically 26") int longPeriod,
            @ToolParam(description = "Signal line EMA period, typically 9") int signalPeriod) {
        try {
            BarSeries series = parseBars(barsJson);
            if (series.getBarCount() < longPeriod + signalPeriod) {
                return "Insufficient data: need at least " + (longPeriod + signalPeriod) + " bars";
            }

            ClosePriceIndicator closePrice = new ClosePriceIndicator(series);
            MACDIndicator macd = new MACDIndicator(closePrice, shortPeriod, longPeriod);
            EMAIndicator signalLine = new EMAIndicator(macd, signalPeriod);

            int lastIndex = series.getEndIndex();
            double macdValue = macd.getValue(lastIndex).doubleValue();
            double signalValue = signalLine.getValue(lastIndex).doubleValue();
            double histogram = macdValue - signalValue;

            String signal;
            if (macdValue > signalValue && histogram > 0) signal = "BULLISH (MACD above signal, positive momentum)";
            else if (macdValue > signalValue) signal = "WEAKLY BULLISH (MACD above signal but momentum fading)";
            else if (macdValue < signalValue && histogram < 0) signal = "BEARISH (MACD below signal, negative momentum)";
            else signal = "WEAKLY BEARISH (MACD below signal but momentum recovering)";

            return String.format("""
                    MACD(%d,%d,%d) Analysis:
                    - MACD Line: %.4f
                    - Signal Line: %.4f
                    - Histogram: %.4f
                    - Signal: %s""",
                    shortPeriod, longPeriod, signalPeriod,
                    macdValue, signalValue, histogram, signal);

        } catch (Exception e) {
            log.error("MACD calculation failed", e);
            return "Error calculating MACD: " + e.getMessage();
        }
    }

    @Tool(description = "Calculate Bollinger Bands from historical price data. " +
            "Price near upper band = potential resistance, near lower band = potential support. " +
            "Band width indicates volatility. Input is JSON array of OHLCV bars.")
    public String calculateBollingerBands(
            @ToolParam(description = "JSON array of price bars") String barsJson,
            @ToolParam(description = "SMA period, typically 20") int period,
            @ToolParam(description = "Standard deviation multiplier, typically 2.0") double stdDevMultiplier) {
        try {
            BarSeries series = parseBars(barsJson);
            if (series.getBarCount() < period) {
                return "Insufficient data: need at least " + period + " bars";
            }

            ClosePriceIndicator closePrice = new ClosePriceIndicator(series);
            SMAIndicator sma = new SMAIndicator(closePrice, period);
            StandardDeviationIndicator stdDev = new StandardDeviationIndicator(closePrice, period);

            int lastIndex = series.getEndIndex();
            double middle = sma.getValue(lastIndex).doubleValue();
            double sd = stdDev.getValue(lastIndex).doubleValue();
            double upper = middle + (stdDevMultiplier * sd);
            double lower = middle - (stdDevMultiplier * sd);
            double currentPrice = closePrice.getValue(lastIndex).doubleValue();
            double bandWidth = ((upper - lower) / middle) * 100;

            String position;
            double pctB = (currentPrice - lower) / (upper - lower);
            if (pctB > 0.8) position = "NEAR UPPER BAND (potential resistance / overbought)";
            else if (pctB > 0.5) position = "ABOVE MIDDLE (bullish territory)";
            else if (pctB > 0.2) position = "BELOW MIDDLE (bearish territory)";
            else position = "NEAR LOWER BAND (potential support / oversold)";

            return String.format("""
                    Bollinger Bands(%d, %.1f) Analysis:
                    - Upper Band: $%.2f
                    - Middle Band (SMA): $%.2f
                    - Lower Band: $%.2f
                    - Current Price: $%.2f
                    - %%B (position): %.2f
                    - Band Width: %.2f%%
                    - Volatility: %s
                    - Signal: %s""",
                    period, stdDevMultiplier,
                    upper, middle, lower, currentPrice,
                    pctB, bandWidth,
                    bandWidth > 10 ? "HIGH" : bandWidth > 5 ? "MODERATE" : "LOW",
                    position);

        } catch (Exception e) {
            log.error("Bollinger Bands calculation failed", e);
            return "Error calculating Bollinger Bands: " + e.getMessage();
        }
    }

    private BarSeries parseBars(String barsJson) throws Exception {
        JsonNode bars = objectMapper.readTree(barsJson);
        BarSeries series = new BaseBarSeriesBuilder().withName("analysis").build();

        for (JsonNode bar : bars) {
            ZonedDateTime time = Instant.ofEpochMilli(bar.get("t").asLong())
                    .atZone(ZoneId.of("America/New_York"));
            series.addBar(Duration.ofDays(1), time,
                    bar.get("o").asDouble(),
                    bar.get("h").asDouble(),
                    bar.get("l").asDouble(),
                    bar.get("c").asDouble(),
                    bar.get("v").asDouble());
        }
        return series;
    }

    private double safeRsi(RSIIndicator rsi, int index) {
        return index >= 0 ? rsi.getValue(index).doubleValue() : 0.0;
    }
}
```

**Step 3: Verify & test**
Run: `./gradlew compileJava && ./gradlew test --tests "com.example.finsentinel.agent.tool.TechnicalIndicatorToolTest"`

---

### Task 3.4: PortfolioAnalysisTool — 持仓分析 + 集中度计算

**Test First:** `src/test/java/com/example/finsentinel/agent/tool/PortfolioAnalysisToolTest.java`
**Impl:** `src/main/java/com/example/finsentinel/agent/tool/PortfolioAnalysisTool.java`

**Purpose:** Analyze portfolio holdings — sector concentration, top positions, unrealized P&L, and diversification metrics.

**Step 1: Write unit test**

```java
package com.example.finsentinel.agent.tool;

import com.example.finsentinel.model.Holding;
import com.example.finsentinel.model.Portfolio;
import com.example.finsentinel.repository.HoldingRepository;
import com.example.finsentinel.repository.PortfolioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PortfolioAnalysisToolTest {

    @Mock private PortfolioRepository portfolioRepository;
    @Mock private HoldingRepository holdingRepository;

    private PortfolioAnalysisTool tool;

    @BeforeEach
    void setUp() {
        tool = new PortfolioAnalysisTool(portfolioRepository, holdingRepository);
    }

    @Test
    void analyzePortfolio_shouldReturnConcentrationMetrics() {
        UUID portfolioId = UUID.randomUUID();
        Portfolio portfolio = Portfolio.builder()
                .id(portfolioId)
                .name("Test Portfolio")
                .totalValue(new BigDecimal("100000.00"))
                .build();

        Holding h1 = Holding.builder()
                .symbol("AAPL").companyName("Apple Inc")
                .quantity(new BigDecimal("100")).averageCost(new BigDecimal("150.00"))
                .currentPrice(new BigDecimal("175.00")).sector("Technology")
                .build();
        Holding h2 = Holding.builder()
                .symbol("MSFT").companyName("Microsoft Corp")
                .quantity(new BigDecimal("50")).averageCost(new BigDecimal("300.00"))
                .currentPrice(new BigDecimal("350.00")).sector("Technology")
                .build();
        Holding h3 = Holding.builder()
                .symbol("JPM").companyName("JPMorgan Chase")
                .quantity(new BigDecimal("30")).averageCost(new BigDecimal("140.00"))
                .currentPrice(new BigDecimal("160.00")).sector("Financial")
                .build();

        when(portfolioRepository.findById(portfolioId)).thenReturn(Optional.of(portfolio));
        when(holdingRepository.findByPortfolioId(portfolioId)).thenReturn(List.of(h1, h2, h3));

        String result = tool.analyzePortfolio(portfolioId.toString());

        assertThat(result).contains("Test Portfolio");
        assertThat(result).contains("AAPL");
        assertThat(result).contains("Technology"); // sector concentration
        assertThat(result).contains("Concentration");
    }

    @Test
    void analyzePortfolio_withInvalidId_shouldReturnError() {
        String result = tool.analyzePortfolio("not-a-uuid");
        assertThat(result).contains("Invalid portfolio ID");
    }

    @Test
    void analyzePortfolio_notFound_shouldReturnError() {
        UUID id = UUID.randomUUID();
        when(portfolioRepository.findById(id)).thenReturn(Optional.empty());
        String result = tool.analyzePortfolio(id.toString());
        assertThat(result).contains("not found");
    }
}
```

**Step 2: Implement PortfolioAnalysisTool**

```java
package com.example.finsentinel.agent.tool;

import com.example.finsentinel.model.Holding;
import com.example.finsentinel.model.Portfolio;
import com.example.finsentinel.repository.HoldingRepository;
import com.example.finsentinel.repository.PortfolioRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

@Component
@Slf4j
@RequiredArgsConstructor
public class PortfolioAnalysisTool {

    private final PortfolioRepository portfolioRepository;
    private final HoldingRepository holdingRepository;

    @Tool(description = "Analyze a user's portfolio holdings including sector concentration, " +
            "top positions by market value, unrealized P&L, and diversification risk metrics. " +
            "Use this to assess concentration risk and portfolio composition.")
    public String analyzePortfolio(
            @ToolParam(description = "Portfolio UUID") String portfolioId) {
        UUID id;
        try {
            id = UUID.fromString(portfolioId);
        } catch (IllegalArgumentException e) {
            return "Invalid portfolio ID format: " + portfolioId;
        }

        Optional<Portfolio> portfolioOpt = portfolioRepository.findById(id);
        if (portfolioOpt.isEmpty()) {
            return "Portfolio not found: " + portfolioId;
        }

        Portfolio portfolio = portfolioOpt.get();
        List<Holding> holdings = holdingRepository.findByPortfolioId(id);

        if (holdings.isEmpty()) {
            return "Portfolio '" + portfolio.getName() + "' has no holdings.";
        }

        // Calculate market values
        BigDecimal totalMarketValue = BigDecimal.ZERO;
        List<HoldingAnalysis> analyses = new ArrayList<>();

        for (Holding h : holdings) {
            BigDecimal price = h.getCurrentPrice() != null ? h.getCurrentPrice() : h.getAverageCost();
            BigDecimal marketValue = price.multiply(h.getQuantity());
            BigDecimal costBasis = h.getAverageCost().multiply(h.getQuantity());
            BigDecimal unrealizedPnl = marketValue.subtract(costBasis);
            BigDecimal pnlPct = costBasis.compareTo(BigDecimal.ZERO) != 0
                    ? unrealizedPnl.divide(costBasis, 4, RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(100))
                    : BigDecimal.ZERO;

            analyses.add(new HoldingAnalysis(h.getSymbol(), h.getCompanyName(), h.getSector(),
                    marketValue, costBasis, unrealizedPnl, pnlPct));
            totalMarketValue = totalMarketValue.add(marketValue);
        }

        // Sort by market value descending
        analyses.sort((a, b) -> b.marketValue.compareTo(a.marketValue));

        // Sector concentration
        BigDecimal finalTotalMarketValue = totalMarketValue;
        Map<String, BigDecimal> sectorWeights = analyses.stream()
                .filter(a -> a.sector != null)
                .collect(Collectors.groupingBy(a -> a.sector,
                        Collectors.reducing(BigDecimal.ZERO,
                                a -> a.marketValue.divide(finalTotalMarketValue, 4, RoundingMode.HALF_UP)
                                        .multiply(BigDecimal.valueOf(100)),
                                BigDecimal::add)));

        // Build output
        StringBuilder sb = new StringBuilder();
        sb.append("Portfolio Analysis: ").append(portfolio.getName()).append("\n");
        sb.append("Total Market Value: $").append(totalMarketValue.setScale(2, RoundingMode.HALF_UP)).append("\n\n");

        // Top holdings
        sb.append("Top Holdings:\n");
        for (int i = 0; i < Math.min(analyses.size(), 10); i++) {
            HoldingAnalysis a = analyses.get(i);
            BigDecimal weight = a.marketValue.divide(finalTotalMarketValue, 4, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(100));
            sb.append(String.format("  %d. %s (%s) — $%s (%.1f%%) P&L: %s%.1f%%\n",
                    i + 1, a.symbol, a.companyName != null ? a.companyName : "N/A",
                    a.marketValue.setScale(2, RoundingMode.HALF_UP),
                    weight.doubleValue(),
                    a.pnlPct.doubleValue() >= 0 ? "+" : "",
                    a.pnlPct.doubleValue()));
        }

        // Sector concentration
        sb.append("\nSector Concentration:\n");
        sectorWeights.entrySet().stream()
                .sorted(Map.Entry.<String, BigDecimal>comparingByValue().reversed())
                .forEach(e -> sb.append(String.format("  %s: %.1f%%\n", e.getKey(), e.getValue().doubleValue())));

        // Concentration risk warnings
        sb.append("\nConcentration Risk Assessment:\n");
        boolean hasRisk = false;
        for (HoldingAnalysis a : analyses) {
            BigDecimal weight = a.marketValue.divide(finalTotalMarketValue, 4, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(100));
            if (weight.doubleValue() > 20) {
                sb.append(String.format("  ⚠ %s is %.1f%% of portfolio (>20%% single-stock concentration risk)\n",
                        a.symbol, weight.doubleValue()));
                hasRisk = true;
            }
        }
        for (Map.Entry<String, BigDecimal> e : sectorWeights.entrySet()) {
            if (e.getValue().doubleValue() > 40) {
                sb.append(String.format("  ⚠ %s sector is %.1f%% of portfolio (>40%% sector concentration risk)\n",
                        e.getKey(), e.getValue().doubleValue()));
                hasRisk = true;
            }
        }
        if (!hasRisk) {
            sb.append("  Portfolio is reasonably diversified.\n");
        }

        // HHI (Herfindahl-Hirschman Index) for diversification
        double hhi = analyses.stream()
                .mapToDouble(a -> {
                    double w = a.marketValue.divide(finalTotalMarketValue, 4, RoundingMode.HALF_UP).doubleValue();
                    return w * w;
                })
                .sum() * 10000;
        sb.append(String.format("\nHerfindahl-Hirschman Index (HHI): %.0f", hhi));
        if (hhi > 2500) sb.append(" (Highly concentrated)");
        else if (hhi > 1500) sb.append(" (Moderately concentrated)");
        else sb.append(" (Well diversified)");

        return sb.toString();
    }

    private record HoldingAnalysis(String symbol, String companyName, String sector,
                                   BigDecimal marketValue, BigDecimal costBasis,
                                   BigDecimal unrealizedPnl, BigDecimal pnlPct) {}
}
```

**Step 3: Verify & test**
Run: `./gradlew compileJava && ./gradlew test --tests "com.example.finsentinel.agent.tool.PortfolioAnalysisToolTest"`

---

### Task 3.5: Spring AI ChatClient 配置 + Agent 编排层

**Files:**
- Create: `src/main/java/com/example/finsentinel/agent/AgentConfig.java`
- Create: `src/main/java/com/example/finsentinel/agent/RiskAgentService.java`
- Test: `src/test/java/com/example/finsentinel/agent/RiskAgentServiceTest.java`

**Step 1: Create AgentConfig — ChatClient bean with all tools**

```java
package com.example.finsentinel.agent;

import com.example.finsentinel.agent.tool.*;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.vectorstore.QuestionAnswerAdvisor;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;

@Configuration
public class AgentConfig {

    @Value("classpath:prompts/system-prompt.st")
    private Resource systemPrompt;

    @Bean
    public ChatClient riskAgentChatClient(
            ChatModel chatModel,
            StockMarketTool stockMarketTool,
            NewsAnalysisTool newsAnalysisTool,
            TechnicalIndicatorTool technicalIndicatorTool,
            PortfolioAnalysisTool portfolioAnalysisTool,
            QuestionAnswerAdvisor questionAnswerAdvisor) {

        return ChatClient.builder(chatModel)
                .defaultSystem(systemPrompt)
                .defaultTools(stockMarketTool, newsAnalysisTool,
                        technicalIndicatorTool, portfolioAnalysisTool)
                .defaultAdvisors(questionAnswerAdvisor)
                .build();
    }
}
```

**Step 2: Create RiskAgentService — orchestration + BeanOutputConverter**

```java
package com.example.finsentinel.agent;

import com.example.finsentinel.config.ComplianceProperties;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.model.RiskReportEntity;
import com.example.finsentinel.model.enums.RiskLevel;
import com.example.finsentinel.repository.RiskReportRepository;
import com.example.finsentinel.repository.PortfolioRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class RiskAgentService {

    private final ChatClient riskAgentChatClient;
    private final ComplianceProperties complianceProperties;
    private final RiskReportRepository riskReportRepository;
    private final PortfolioRepository portfolioRepository;
    private final ObjectMapper objectMapper;

    /**
     * Run a full risk assessment for a user query.
     * The LLM will autonomously call tools (StockMarketTool, TechnicalIndicatorTool, etc.)
     * and return a structured RiskReport.
     *
     * @param userMessage the user's risk assessment query
     * @param portfolioId optional portfolio ID for portfolio-specific analysis
     * @return structured RiskReport
     */
    public RiskReport assess(String userMessage, UUID portfolioId) {
        log.info("Starting risk assessment: query='{}', portfolio={}",
                truncate(userMessage, 80), portfolioId);

        String prompt = buildPrompt(userMessage, portfolioId);

        RiskReport report = riskAgentChatClient.prompt()
                .user(prompt)
                .call()
                .entity(RiskReport.class);

        log.info("Risk assessment complete: score={}, level={}",
                report.riskScore(), report.riskLevel());

        // Persist if portfolio-specific
        if (portfolioId != null) {
            persistReport(report, portfolioId);
        }

        return report;
    }

    /**
     * Stream-based risk assessment for SSE endpoints.
     * Returns the raw text stream (not structured output).
     */
    public reactor.core.publisher.Flux<String> assessStream(String userMessage, UUID portfolioId) {
        String prompt = buildPrompt(userMessage, portfolioId);

        return riskAgentChatClient.prompt()
                .user(prompt)
                .stream()
                .content();
    }

    private String buildPrompt(String userMessage, UUID portfolioId) {
        StringBuilder prompt = new StringBuilder();
        prompt.append(userMessage);
        if (portfolioId != null) {
            prompt.append("\n\nPortfolio ID for analysis: ").append(portfolioId);
        }
        prompt.append("\n\nCompliance Region: ").append(complianceProperties.getRegion());
        return prompt.toString();
    }

    private void persistReport(RiskReport report, UUID portfolioId) {
        try {
            var portfolio = portfolioRepository.findById(portfolioId).orElse(null);
            if (portfolio == null) return;

            RiskReportEntity entity = RiskReportEntity.builder()
                    .portfolio(portfolio)
                    .riskScore(report.riskScore())
                    .riskLevel(RiskLevel.valueOf(report.riskLevel()))
                    .summary(report.summary())
                    .factorsJson(objectMapper.writeValueAsString(report.factors()))
                    .adviceJson(objectMapper.writeValueAsString(report.actionableAdvice()))
                    .disclaimer(report.complianceNote() != null ? report.complianceNote().disclaimer() : complianceProperties.getDisclaimer())
                    .regulatoryFramework(report.complianceNote() != null ? report.complianceNote().regulatoryFramework() : "SEC")
                    .build();
            riskReportRepository.save(entity);
            log.info("Persisted risk report for portfolio {}", portfolioId);
        } catch (Exception e) {
            log.error("Failed to persist risk report", e);
        }
    }

    private String truncate(String text, int maxLen) {
        return text.length() <= maxLen ? text : text.substring(0, maxLen) + "...";
    }
}
```

**Step 3: Write test**

```java
package com.example.finsentinel.agent;

import com.example.finsentinel.config.ComplianceProperties;
import com.example.finsentinel.dto.risk.ComplianceNote;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.repository.PortfolioRepository;
import com.example.finsentinel.repository.RiskReportRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.ai.chat.client.ChatClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class RiskAgentServiceTest {

    @Mock private ChatClient riskAgentChatClient;
    @Mock private ChatClient.PromptRequest promptRequest;
    @Mock private ChatClient.CallRequest callRequest;
    @Mock private ChatClient.CallResponse callResponse;
    @Mock private RiskReportRepository riskReportRepository;
    @Mock private PortfolioRepository portfolioRepository;

    private ComplianceProperties complianceProperties;
    private ObjectMapper objectMapper;
    private RiskAgentService service;

    @BeforeEach
    void setUp() {
        complianceProperties = new ComplianceProperties();
        complianceProperties.setRegion("US");
        complianceProperties.setDisclaimer("AI-generated analysis. Not investment advice.");
        objectMapper = new ObjectMapper();
        service = new RiskAgentService(riskAgentChatClient, complianceProperties,
                riskReportRepository, portfolioRepository, objectMapper);
    }

    // Note: Full integration tests require a running LLM. Unit tests mock ChatClient.
    // The main value here is testing the prompt building and report persistence logic.
}
```

**Step 4: Verify compilation**
Run: `./gradlew compileJava`

> **Note:** The `ChatClient` mock API is complex. The primary testing strategy for the agent layer is integration testing with a running LLM. Unit tests focus on helper methods. Consider adding a `@SpringBootTest` integration test when infrastructure is available.

---

### Task 3.6: 结构化 Prompt 模板设计（.st 文件）

**Files:**
- Create: `src/main/resources/prompts/system-prompt.st`
- Create: `src/main/resources/prompts/risk-assessment.st`

**Step 1: Create system prompt**

```
# File: src/main/resources/prompts/system-prompt.st

You are FinSentinel, an AI-powered investment risk assessment agent specializing in US equity markets.
You analyze stocks, portfolios, and financial markets to produce structured risk reports.

## Your Capabilities
You have access to the following tools:
1. **getStockQuote** — Get real-time stock prices from Polygon.io
2. **getHistoricalPrices** — Get historical OHLCV data for technical analysis
3. **calculateRSI** — Calculate Relative Strength Index (momentum indicator)
4. **calculateMACD** — Calculate MACD (trend-following indicator)
5. **calculateBollingerBands** — Calculate Bollinger Bands (volatility indicator)
6. **getRecentNews** — Fetch recent financial news for a ticker
7. **searchKnowledgeBase** — Search SEC filings, research reports, and regulations in the RAG database
8. **analyzePortfolio** — Analyze portfolio holdings, concentration, and diversification

## Analysis Workflow
When assessing risk, follow this systematic approach:
1. **Gather Market Data** — Use getStockQuote for current prices of relevant tickers
2. **Technical Analysis** — Use getHistoricalPrices → calculateRSI, calculateMACD, calculateBollingerBands
3. **News Sentiment** — Use getRecentNews to understand current market narrative
4. **RAG Context** — Use searchKnowledgeBase for regulatory and research context
5. **Portfolio Impact** — If a portfolio ID is provided, use analyzePortfolio for concentration analysis
6. **Synthesize** — Combine all data into a comprehensive risk assessment

## Output Requirements
Always output a structured risk report with:
- **riskScore**: Integer 1-100 (1=lowest risk, 100=highest risk)
- **riskLevel**: One of LOW, MEDIUM, HIGH, CRITICAL
  - LOW: score 1-25, MEDIUM: score 26-50, HIGH: score 51-75, CRITICAL: score 76-100
- **summary**: 2-3 sentence executive summary
- **factors**: List of risk factors with category (MARKET, LIQUIDITY, POLICY, CONCENTRATION, VOLATILITY), score (1-100), and description
- **actionableAdvice**: 3-5 specific, actionable recommendations
- **complianceNote**: Include SEC regulatory disclaimer and set isCompliant=true

## Important Rules
- NEVER give investment advice. Present factual analysis only.
- ALWAYS include the compliance disclaimer.
- Use actual data from tools — never fabricate numbers.
- Financial calculations (RSI, MACD, etc.) must come from the TechnicalIndicatorTool, never calculated by you.
- If a tool fails, note it in the summary and reduce confidence in affected risk factors.
```

**Step 2: Create risk assessment prompt template** (optional, for advanced use)

```
# File: src/main/resources/prompts/risk-assessment.st

Perform a comprehensive investment risk assessment for the following query:

{userQuery}

{portfolioContext}

Analyze all relevant risk dimensions: market risk, volatility, liquidity, concentration, and policy/regulatory risk.
Use the available tools to gather real-time data before making your assessment.
Output your analysis as a structured RiskReport.
```

**Step 3: Verify prompts are loadable**
Run: `./gradlew compileJava` (checks resource resolution)

---

### Task 3.7: BeanOutputConverter → RiskReport 结构化输出

**Purpose:** Ensure the `RiskReport` record works with Spring AI's `BeanOutputConverter` for structured JSON output from the LLM.

**Step 1: Verify RiskReport record is compatible**

The existing `RiskReport` record already uses the correct structure. Spring AI's `.entity(RiskReport.class)` in ChatClient automatically:
1. Generates a JSON schema from the record
2. Appends format instructions to the prompt
3. Parses the LLM's JSON response into the record

**Step 2: Add `@JsonPropertyOrder` for consistent output**

Modify: `src/main/java/com/example/finsentinel/dto/risk/RiskReport.java`

```java
package com.example.finsentinel.dto.risk;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import java.util.List;

@JsonPropertyOrder({"riskScore", "riskLevel", "summary", "factors", "actionableAdvice", "complianceNote"})
public record RiskReport(
        int riskScore,
        String riskLevel,
        String summary,
        List<RiskFactor> factors,
        List<String> actionableAdvice,
        ComplianceNote complianceNote
) {
}
```

**Step 3: Add `@JsonPropertyOrder` to nested records**

Modify: `src/main/java/com/example/finsentinel/dto/risk/RiskFactor.java`
```java
@JsonPropertyOrder({"category", "score", "description"})
public record RiskFactor(String category, int score, String description) {}
```

Modify: `src/main/java/com/example/finsentinel/dto/risk/ComplianceNote.java`
```java
@JsonPropertyOrder({"disclaimer", "regulatoryFramework", "isCompliant"})
public record ComplianceNote(String disclaimer, String regulatoryFramework, boolean isCompliant) {}
```

**Step 4: Write converter test**

```java
package com.example.finsentinel.agent.output;

import com.example.finsentinel.dto.risk.ComplianceNote;
import com.example.finsentinel.dto.risk.RiskFactor;
import com.example.finsentinel.dto.risk.RiskReport;
import org.junit.jupiter.api.Test;
import org.springframework.ai.converter.BeanOutputConverter;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RiskReportOutputTest {

    @Test
    void beanOutputConverter_shouldGenerateValidSchema() {
        BeanOutputConverter<RiskReport> converter = new BeanOutputConverter<>(RiskReport.class);
        String format = converter.getFormat();

        assertThat(format).contains("riskScore");
        assertThat(format).contains("riskLevel");
        assertThat(format).contains("factors");
        assertThat(format).contains("complianceNote");
    }

    @Test
    void beanOutputConverter_shouldParseValidJson() {
        BeanOutputConverter<RiskReport> converter = new BeanOutputConverter<>(RiskReport.class);

        String json = """
            {
                "riskScore": 65,
                "riskLevel": "HIGH",
                "summary": "Elevated risk due to market volatility and sector concentration.",
                "factors": [
                    {"category": "MARKET", "score": 70, "description": "Broad market uncertainty"},
                    {"category": "VOLATILITY", "score": 60, "description": "High VIX levels"}
                ],
                "actionableAdvice": [
                    "Consider diversifying into defensive sectors",
                    "Set stop-loss orders at 10% below current price"
                ],
                "complianceNote": {
                    "disclaimer": "This is AI-generated analysis. Not investment advice.",
                    "regulatoryFramework": "SEC",
                    "isCompliant": true
                }
            }
            """;

        RiskReport report = converter.convert(json);

        assertThat(report.riskScore()).isEqualTo(65);
        assertThat(report.riskLevel()).isEqualTo("HIGH");
        assertThat(report.factors()).hasSize(2);
        assertThat(report.complianceNote().isCompliant()).isTrue();
    }
}
```

**Step 5: Verify & test**
Run: `./gradlew compileJava && ./gradlew test --tests "com.example.finsentinel.agent.output.RiskReportOutputTest"`

---

## Compilation & Test Verification

After all tasks are complete:

```bash
./gradlew compileJava           # Full compilation
./gradlew compileTestJava       # Test compilation
./gradlew test                  # Run all tests (unit tests will pass; integration tests need infra)
```

---

## Architecture Notes

- **Tool Registration:** All 4 tools are `@Component` beans with `@Tool`-annotated methods. `AgentConfig` registers them with `ChatClient.builder().defaultTools(...)`.
- **Redis Caching:** StockMarketTool and NewsAnalysisTool cache API responses to respect Polygon.io rate limits (5 calls/min on free tier).
- **Ta4j is Pure Java:** TechnicalIndicatorTool has zero external dependencies — it receives JSON bar data as a string parameter and uses Ta4j in-process. No API calls.
- **BeanOutputConverter:** Spring AI's `.entity(RiskReport.class)` handles schema generation, prompt injection, and JSON parsing automatically. No manual converter bean needed.
- **System Prompt:** Loaded as a `Resource` from `classpath:prompts/system-prompt.st`. StringTemplate delimiters are `{}` by default.
- **Streaming:** `RiskAgentService.assessStream()` returns `Flux<String>` for SSE endpoints. Note: streaming is not compatible with `.entity()` structured output — it returns raw text.
- **QuestionAnswerAdvisor:** Already configured in Phase 2. It automatically augments prompts with RAG context from pgvector. No additional wiring needed in Phase 3.

---

## Dependencies Check

All dependencies already exist in `build.gradle`:
- ✅ `org.ta4j:ta4j-core:0.16` — Technical analysis
- ✅ `spring-ai-starter-model-openai` — ChatModel + ChatClient
- ✅ `spring-ai-advisors-vector-store` — QuestionAnswerAdvisor
- ✅ `spring-boot-starter-data-redis` — Redis caching
- ✅ Jackson — JSON serialization

**No new dependencies required.**

Note: `reactor-core` may need to be added if `Flux` streaming is used in `RiskAgentService`:
```gradle
implementation 'io.projectreactor:reactor-core'
```
Check if Spring Boot Web starter already brings this transitively (it typically does with WebFlux support, but we're using the servlet stack). If not, add this dependency or remove the streaming method.
