package com.example.finsentinel.service;

import com.example.finsentinel.config.PolygonProperties;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class MarketDataService {

    private final RestClient restClient;
    private final PolygonProperties polygonProperties;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    private static final Duration QUOTE_TTL = Duration.ofMinutes(5);
    private static final Duration HISTORY_TTL = Duration.ofMinutes(30);

    public Map<String, Object> getQuote(String ticker) {
        ticker = validateTicker(ticker);
        String cacheKey = "market:quote:" + ticker;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            log.debug("Cache hit for quote: {}", ticker);
            return parseJsonMap(cached);
        }

        JsonNode bar = fetchLatestBar(ticker);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ticker", ticker);
        result.put("close", bar.get("c").asDouble());
        result.put("open", bar.get("o").asDouble());
        result.put("high", bar.get("h").asDouble());
        result.put("low", bar.get("l").asDouble());
        result.put("volume", bar.get("v").asLong());
        result.put("timestamp", bar.get("t").asLong());

        cacheJson(cacheKey, result, QUOTE_TTL);
        log.info("Fetched quote for {}: close=${}", ticker, bar.get("c").asDouble());
        return result;
    }

    public JsonNode getHistory(String ticker, int days) {
        ticker = validateTicker(ticker);
        days = Math.min(Math.max(days, 1), 365);
        String cacheKey = "market:history:" + ticker + ":" + days;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            log.debug("Cache hit for history: {} ({}d)", ticker, days);
            return parseJsonNode(cached);
        }

        String to = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);
        String from = LocalDate.now().minusDays(days).format(DateTimeFormatter.ISO_LOCAL_DATE);
        JsonNode response = callPolygonAggs(ticker, from, to, "asc", days + 10);

        if (response == null || !response.has("results")) {
            throw new IllegalArgumentException("No historical data for " + ticker);
        }

        JsonNode results = response.get("results");
        redisTemplate.opsForValue().set(cacheKey, results.toString(), HISTORY_TTL);
        log.info("Fetched {} days of history for {}", days, ticker);
        return results;
    }

    public Map<String, Object> getBatchQuotes(List<String> tickers) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String ticker : tickers) {
            try {
                result.put(ticker.toUpperCase().trim(), getQuote(ticker));
            } catch (Exception e) {
                result.put(ticker.toUpperCase().trim(), Map.of("error", e.getMessage()));
            }
        }
        return result;
    }

    /**
     * Human-readable quote text for AI tools (StockMarketTool).
     */
    public String getQuoteText(String ticker) {
        ticker = validateTicker(ticker);
        String cacheKey = "stock:quote:" + ticker;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return cached;
        }

        JsonNode bar = fetchLatestBar(ticker);
        String today = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);
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

        redisTemplate.opsForValue().set(cacheKey, result, QUOTE_TTL);
        return result;
    }

    /**
     * JSON string format for AI tools (StockMarketTool historical data).
     */
    public String getHistoryJson(String ticker, int days) {
        ticker = validateTicker(ticker);
        days = Math.min(Math.max(days, 1), 365);
        String cacheKey = "stock:history:" + ticker + ":" + days;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return cached;
        }

        String to = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);
        String from = LocalDate.now().minusDays(days).format(DateTimeFormatter.ISO_LOCAL_DATE);
        JsonNode response = callPolygonAggs(ticker, from, to, "asc", days + 10);

        if (response == null || !response.has("results")) {
            return "No historical data for " + ticker;
        }

        String result = response.get("results").toString();
        redisTemplate.opsForValue().set(cacheKey, result, HISTORY_TTL);
        return result;
    }

    String validateTicker(String ticker) {
        if (ticker == null) throw new IllegalArgumentException("Invalid ticker: null");
        ticker = ticker.toUpperCase().trim();
        if (!ticker.matches("^[A-Z]{1,5}$")) {
            throw new IllegalArgumentException("Invalid ticker symbol: " + ticker + ". Must be 1-5 uppercase letters.");
        }
        return ticker;
    }

    private JsonNode fetchLatestBar(String ticker) {
        String today = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);
        String from = LocalDate.now().minusDays(5).format(DateTimeFormatter.ISO_LOCAL_DATE);

        JsonNode response = callPolygonAggs(ticker, from, today, "desc", 1);

        if (response == null || !response.has("results") || response.get("results").isEmpty()) {
            throw new IllegalArgumentException("No market data available for " + ticker);
        }
        return response.get("results").get(0);
    }

    private JsonNode callPolygonAggs(String ticker, String from, String to, String sort, int limit) {
        return restClient.get()
                .uri(polygonProperties.getBaseUrl()
                                + "/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}?adjusted=true&sort={sort}&limit={limit}&apiKey={apiKey}",
                        ticker, from, to, sort, limit, polygonProperties.getApiKey())
                .retrieve()
                .body(JsonNode.class);
    }

    private void cacheJson(String key, Map<String, Object> value, Duration ttl) {
        try {
            redisTemplate.opsForValue().set(key, objectMapper.writeValueAsString(value), ttl);
        } catch (JsonProcessingException e) {
            log.error("Failed to cache JSON for key {}", key, e);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseJsonMap(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (JsonProcessingException e) {
            log.error("Failed to parse cached JSON", e);
            return Map.of();
        }
    }

    private JsonNode parseJsonNode(String json) {
        try {
            return objectMapper.readTree(json);
        } catch (JsonProcessingException e) {
            log.error("Failed to parse cached JSON node", e);
            return objectMapper.createObjectNode();
        }
    }
}
