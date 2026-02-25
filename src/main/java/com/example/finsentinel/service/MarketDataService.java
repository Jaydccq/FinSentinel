package com.example.finsentinel.service;

import com.example.finsentinel.dto.market.MarketBar;
import com.example.finsentinel.dto.market.MarketQuote;
import com.example.finsentinel.dto.market.TickerSearchResult;
import com.example.finsentinel.service.market.MarketDataProvider;
import com.example.finsentinel.service.market.MarketDataProviderRegistry;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
/**
 * Provides market quote and history retrieval backed by a pluggable
 * {@link MarketDataProvider} and Redis cache.
 *
 * <p>This service is the public-facing API consumed by controllers and AI tools.
 * It delegates data fetching to the active provider via
 * {@link MarketDataProviderRegistry} while keeping the caching, validation,
 * and response-formatting concerns in one place.
 *
 * <p>The public method signatures are intentionally unchanged from the original
 * Polygon-only implementation so that {@code StockMarketTool},
 * {@code MarketDataController}, and all existing tests remain fully compatible.
 */
public class MarketDataService {

    private final MarketDataProviderRegistry providerRegistry;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final RestClient restClient;

    private static final Duration QUOTE_TTL = Duration.ofMinutes(5);
    private static final Duration HISTORY_TTL = Duration.ofMinutes(30);
    private static final Duration SEARCH_TTL = Duration.ofMinutes(10);

    /**
     * Retrieves the latest quote payload for a ticker.
     *
     * <p>The method validates the ticker, checks Redis cache first, falls back to
     * the active provider when needed, and caches the normalized response map.
     *
     * @param ticker raw ticker symbol input
     * @return a map containing ticker, OHLC, volume, and timestamp fields
     * @throws IllegalArgumentException if ticker format is invalid or no data exists
     */
    public Map<String, Object> getQuote(String ticker) {
        ticker = validateTicker(ticker);
        String cacheKey = "market:quote:" + ticker;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            Map<String, Object> parsed = parseJsonMap(cached);
            if (!parsed.isEmpty()) {
                log.debug("Cache hit for quote: {}", ticker);
                return parsed;
            }
            // Cache corrupted -- evict and fall through to origin
            redisTemplate.delete(cacheKey);
            log.warn("Evicted corrupted quote cache for {}", ticker);
        }

        MarketQuote quote = provider().getQuote(ticker);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("ticker", quote.ticker());
        result.put("close", quote.close().doubleValue());
        result.put("open", quote.open().doubleValue());
        result.put("high", quote.high().doubleValue());
        result.put("low", quote.low().doubleValue());
        result.put("volume", quote.volume());
        result.put("timestamp", quote.timestamp());

        cacheJson(cacheKey, result, QUOTE_TTL);
        log.info("Fetched quote for {}: close=${}", ticker, quote.close());
        return result;
    }

    /**
     * Retrieves historical daily bars for the requested ticker and day window.
     *
     * <p>The day window is clamped to [1, 365], responses are cached in Redis,
     * and the result format matches the original Polygon "results" array so that
     * downstream consumers (AI tools, controllers) remain unchanged.
     *
     * @param ticker raw ticker symbol input
     * @param days number of days requested
     * @return JSON array of OHLCV bar objects (Polygon-compatible field names)
     * @throws IllegalArgumentException if ticker is invalid or history is unavailable
     */
    public JsonNode getHistory(String ticker, int days) {
        ticker = validateTicker(ticker);
        days = Math.min(Math.max(days, 1), 365);
        String cacheKey = "market:history:" + ticker + ":" + days;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            JsonNode parsed = parseJsonNode(cached);
            if (!parsed.isEmpty()) {
                log.debug("Cache hit for history: {} ({}d)", ticker, days);
                return parsed;
            }
            // Cache corrupted -- evict and fall through to origin
            redisTemplate.delete(cacheKey);
            log.warn("Evicted corrupted history cache for {} ({}d)", ticker, days);
        }

        List<MarketBar> bars = provider().getHistoricalBars(ticker, days);
        JsonNode results = barsToJsonNode(bars);

        redisTemplate.opsForValue().set(cacheKey, results.toString(), HISTORY_TTL);
        log.info("Fetched {} days of history for {}", days, ticker);
        return results;
    }

    /**
     * Fetches quote data for multiple tickers in sequence.
     *
     * <p>Each ticker is resolved independently; failures are returned as per-ticker
     * error entries instead of aborting the whole batch.
     *
     * @param tickers list of ticker symbols
     * @return map keyed by normalized ticker to quote payload or error payload
     */
    public Map<String, Object> getBatchQuotes(List<String> tickers) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String ticker : tickers) {
            if (ticker == null || ticker.isBlank()) continue;
            String key = ticker.toUpperCase().trim();
            try {
                result.put(key, getQuote(ticker));
            } catch (Exception e) {
                result.put(key, Map.of("error", e.getMessage() != null ? e.getMessage() : "Unknown error"));
            }
        }
        return result;
    }

    /**
     * Searches Yahoo Finance for tickers matching the given query.
     *
     * <p>Results are cached in Redis for 10 minutes to reduce external API calls.
     * The limit is clamped to [1, 20].
     *
     * @param query search string (e.g. "APP", "Apple")
     * @param limit maximum number of results to return
     * @return list of matching ticker search results
     */
    public List<TickerSearchResult> searchTickers(String query, int limit) {
        if (query == null || query.isBlank()) return List.of();
        String safeQuery = query.trim();
        int safeLimit = Math.max(1, Math.min(limit, 20));

        String cacheKey = "market:search:" + safeQuery.toLowerCase() + ":" + safeLimit;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            try {
                return objectMapper.readValue(cached, new TypeReference<List<TickerSearchResult>>() {});
            } catch (JacksonException e) {
                redisTemplate.delete(cacheKey);
            }
        }

        String url = "https://query2.finance.yahoo.com/v1/finance/search?q="
            + URLEncoder.encode(safeQuery, StandardCharsets.UTF_8)
            + "&quotesCount=" + safeLimit
            + "&newsCount=0&listsCount=0";

        try {
            String response = restClient.get()
                .uri(url)
                .header("User-Agent", "Mozilla/5.0")
                .retrieve()
                .body(String.class);

            JsonNode root = objectMapper.readTree(response);
            JsonNode quotes = root.path("quotes");
            List<TickerSearchResult> results = new ArrayList<>();

            for (JsonNode q : quotes) {
                results.add(new TickerSearchResult(
                    q.path("symbol").asText(),
                    q.path("shortname").asText(q.path("longname").asText("")),
                    q.path("exchange").asText(""),
                    q.path("quoteType").asText("EQUITY")
                ));
            }

            try {
                redisTemplate.opsForValue().set(cacheKey,
                    objectMapper.writeValueAsString(results), SEARCH_TTL);
            } catch (JacksonException e) {
                log.error("Failed to cache ticker search results", e);
            }
            return results;
        } catch (Exception e) {
            log.warn("Yahoo Finance search failed for query '{}': {}", safeQuery, e.getMessage());
            return List.of();
        }
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

        MarketQuote quote = provider().getQuote(ticker);
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
                quote.close().doubleValue(),
                quote.open().doubleValue(),
                quote.high().doubleValue(),
                quote.low().doubleValue(),
                quote.volume(),
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

        List<MarketBar> bars = provider().getHistoricalBars(ticker, days);
        if (bars.isEmpty()) {
            return "No historical data for " + ticker;
        }

        String result = barsToJsonNode(bars).toString();
        redisTemplate.opsForValue().set(cacheKey, result, HISTORY_TTL);
        return result;
    }

    String validateTicker(String ticker) {
        if (ticker == null) throw new IllegalArgumentException("Invalid ticker: null");
        ticker = ticker.toUpperCase().trim();
        // Allow: AAPL, BTC/USD (CCXT), BTC-USD (Yahoo crypto), AAPL.L (LSE)
        if (!ticker.matches("^[A-Z]{1,10}([/\\-.][A-Z]{1,5})?$")) {
            throw new IllegalArgumentException(
                "Invalid ticker symbol: " + ticker +
                ". Must be 1-10 uppercase letters, optionally with /PAIR, -PAIR, or .SUFFIX.");
        }
        return ticker;
    }

    // ──────────────────────────────── internal helpers ───────────────────────────

    /**
     * Resolves the active market data provider from the registry.
     */
    private MarketDataProvider provider() {
        return providerRegistry.getDefaultProvider();
    }

    /**
     * Converts a list of {@link MarketBar} records into a JSON array node with
     * Polygon-compatible field names ({@code o,h,l,c,v,t}) so that downstream
     * consumers like {@code TechnicalIndicatorTool.parseBars()} remain unchanged.
     */
    private JsonNode barsToJsonNode(List<MarketBar> bars) {
        var arrayNode = objectMapper.createArrayNode();
        for (MarketBar bar : bars) {
            var node = objectMapper.createObjectNode();
            node.put("o", bar.open().doubleValue());
            node.put("h", bar.high().doubleValue());
            node.put("l", bar.low().doubleValue());
            node.put("c", bar.close().doubleValue());
            node.put("v", bar.volume());
            node.put("t", bar.timestamp());
            arrayNode.add(node);
        }
        return arrayNode;
    }

    /**
     * Serializes and caches a map payload into Redis with TTL.
     */
    private void cacheJson(String key, Map<String, Object> value, Duration ttl) {
        try {
            redisTemplate.opsForValue().set(key, objectMapper.writeValueAsString(value), ttl);
        } catch (JacksonException e) {
            log.error("Failed to cache JSON for key {}", key, e);
        }
    }

    /**
     * Parses a JSON object string into a map structure.
     */
    private Map<String, Object> parseJsonMap(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (JacksonException e) {
            log.error("Failed to parse cached JSON", e);
            return Map.of();
        }
    }

    /**
     * Parses a JSON string into a Jackson tree.
     */
    private JsonNode parseJsonNode(String json) {
        try {
            return objectMapper.readTree(json);
        } catch (JacksonException e) {
            log.error("Failed to parse cached JSON node", e);
            return objectMapper.createObjectNode();
        }
    }
}
