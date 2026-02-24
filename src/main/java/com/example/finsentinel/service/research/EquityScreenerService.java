package com.example.finsentinel.service.research;

import com.example.finsentinel.config.PolygonProperties;
import com.example.finsentinel.dto.research.ScreenerCriteria;
import com.example.finsentinel.dto.research.ScreenerResult;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Equity screening service inspired by OpenBB's Discovery Extension.
 *
 * <p>Provides three capabilities:
 * <ul>
 *   <li>{@link #screen(ScreenerCriteria)} -- multi-criteria ticker screening via
 *       Polygon's reference tickers API</li>
 *   <li>{@link #getMarketMovers(String)} -- today's top gainers, losers, or
 *       most-active via Polygon's snapshot API</li>
 *   <li>{@link #searchTickers(String, int)} -- lightweight ticker/name search</li>
 * </ul>
 *
 * <p>Results are cached in Redis (4 hours for screens, 15 minutes for movers)
 * to minimise Polygon API usage.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EquityScreenerService {

    private final RestClient restClient;
    private final PolygonProperties polygonProperties;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    private static final Duration SCREENER_CACHE_TTL = Duration.ofHours(4);
    private static final Duration MOVERS_CACHE_TTL = Duration.ofMinutes(15);

    // Exchange name -> MIC code mapping
    private static final Map<String, String> EXCHANGE_MIC_MAP = Map.of(
            "NASDAQ", "XNAS",
            "NYSE", "XNYS",
            "AMEX", "XASE",
            "ARCA", "ARCX"
    );

    /**
     * Screens equities using the Polygon.io reference tickers API.
     *
     * <p>Builds query parameters from the supplied criteria, calls the API, and
     * maps the {@code results} array into {@link ScreenerResult} records. Results
     * are cached by criteria hash for {@value #SCREENER_CACHE_TTL} hours.
     *
     * @param criteria screening filters, sort, and limit
     * @return matching tickers (may be empty, never null)
     */
    public List<ScreenerResult> screen(ScreenerCriteria criteria) {
        String cacheKey = "screener:screen:" + criteriaHash(criteria);
        List<ScreenerResult> cached = readCache(cacheKey);
        if (cached != null) {
            log.debug("Cache hit for screener criteria: {}", cacheKey);
            return cached;
        }

        try {
            String url = buildScreenerUrl(criteria);
            log.debug("Polygon screener request: {}", url.replaceAll("apiKey=[^&]+", "apiKey=***"));

            JsonNode response = restClient.get()
                    .uri(url)
                    .retrieve()
                    .body(JsonNode.class);

            List<ScreenerResult> results = parseTickerResults(response);

            // Post-filter by market cap if criteria specify min/max
            results = filterByMarketCap(results, criteria.marketCapMin(), criteria.marketCapMax());

            writeCache(cacheKey, results, SCREENER_CACHE_TTL);
            log.info("Screener returned {} results", results.size());
            return results;

        } catch (Exception e) {
            log.error("Equity screening failed", e);
            return Collections.emptyList();
        }
    }

    /**
     * Returns today's top market movers from Polygon's snapshot API.
     *
     * @param type one of {@code "gainers"}, {@code "losers"}, or {@code "most_active"}
     * @return up to 20 movers (may be empty, never null)
     */
    public List<ScreenerResult> getMarketMovers(String type) {
        if (type == null || !List.of("gainers", "losers", "most_active").contains(type.toLowerCase())) {
            type = "gainers";
        }
        type = type.toLowerCase();

        String cacheKey = "screener:movers:" + type;
        List<ScreenerResult> cached = readCache(cacheKey);
        if (cached != null) {
            log.debug("Cache hit for market movers: {}", type);
            return cached;
        }

        try {
            String url = String.format("%s/v2/snapshot/locale/us/markets/stocks/%s?apiKey=%s",
                    polygonProperties.getBaseUrl(), type, polygonProperties.getApiKey());

            JsonNode response = restClient.get()
                    .uri(url)
                    .retrieve()
                    .body(JsonNode.class);

            List<ScreenerResult> results = parseSnapshotResults(response);

            writeCache(cacheKey, results, MOVERS_CACHE_TTL);
            log.info("Market movers ({}) returned {} results", type, results.size());
            return results;

        } catch (Exception e) {
            log.error("Failed to fetch market movers ({})", type, e);
            return Collections.emptyList();
        }
    }

    /**
     * Searches for tickers by name or symbol keyword.
     *
     * @param query search text (name or ticker fragment)
     * @param limit max results to return (clamped to 1-50)
     * @return matching tickers (may be empty, never null)
     */
    public List<ScreenerResult> searchTickers(String query, int limit) {
        if (query == null || query.isBlank()) {
            return Collections.emptyList();
        }
        limit = Math.min(Math.max(limit, 1), 50);

        String cacheKey = "screener:search:" + query.toLowerCase().trim() + ":" + limit;
        List<ScreenerResult> cached = readCache(cacheKey);
        if (cached != null) {
            log.debug("Cache hit for ticker search: {}", query);
            return cached;
        }

        try {
            String url = String.format(
                    "%s/v3/reference/tickers?search=%s&active=true&limit=%d&apiKey=%s",
                    polygonProperties.getBaseUrl(),
                    query.trim(),
                    limit,
                    polygonProperties.getApiKey());

            JsonNode response = restClient.get()
                    .uri(url)
                    .retrieve()
                    .body(JsonNode.class);

            List<ScreenerResult> results = parseTickerResults(response);

            writeCache(cacheKey, results, SCREENER_CACHE_TTL);
            log.info("Ticker search for '{}' returned {} results", query, results.size());
            return results;

        } catch (Exception e) {
            log.error("Ticker search failed for '{}'", query, e);
            return Collections.emptyList();
        }
    }

    // ──────────────────────────────── URL construction ────────────────────────────

    /**
     * Builds the Polygon reference tickers URL from screening criteria.
     */
    private String buildScreenerUrl(ScreenerCriteria criteria) {
        StringBuilder url = new StringBuilder(polygonProperties.getBaseUrl())
                .append("/v3/reference/tickers?market=stocks&active=true");

        // Common stock filter
        url.append("&type=CS");

        // Exchange filter (map friendly names to MIC codes)
        if (criteria.exchange() != null && !criteria.exchange().isBlank()) {
            String mic = EXCHANGE_MIC_MAP.getOrDefault(
                    criteria.exchange().toUpperCase(), criteria.exchange().toUpperCase());
            url.append("&exchange=").append(mic);
        }

        // Search query
        if (criteria.search() != null && !criteria.search().isBlank()) {
            url.append("&search=").append(criteria.search().trim());
        }

        // Sort and order
        url.append("&sort=").append(criteria.sortBy());
        url.append("&order=").append(criteria.order());

        // Limit (request extra to allow post-filtering)
        int requestLimit = criteria.limit();
        if (criteria.marketCapMin() != null || criteria.marketCapMax() != null) {
            requestLimit = Math.min(requestLimit * 3, 100); // request more for post-filtering
        }
        url.append("&limit=").append(requestLimit);

        // API key
        url.append("&apiKey=").append(polygonProperties.getApiKey());

        return url.toString();
    }

    // ──────────────────────────────── response parsing ────────────────────────────

    /**
     * Parses the {@code results} array from a Polygon {@code /v3/reference/tickers} response
     * into {@link ScreenerResult} records.
     */
    private List<ScreenerResult> parseTickerResults(JsonNode response) {
        List<ScreenerResult> results = new ArrayList<>();
        if (response == null || !response.has("results")) {
            return results;
        }

        JsonNode resultsNode = response.get("results");
        for (JsonNode node : resultsNode) {
            results.add(new ScreenerResult(
                    textOrNull(node, "ticker"),
                    textOrNull(node, "name"),
                    textOrNull(node, "primary_exchange"),
                    textOrNull(node, "type"),
                    textOrNull(node, "locale"),
                    decimalOrNull(node, "market_cap"),
                    textOrNull(node, "currency_name"),
                    node.has("active") && node.get("active").asBoolean(true)
            ));
        }
        return results;
    }

    /**
     * Parses the {@code tickers} array from a Polygon snapshot movers response.
     *
     * <p>The snapshot API nests ticker info inside each entry's {@code ticker} object,
     * with the market data in {@code day} or {@code todaysChange} fields.
     */
    private List<ScreenerResult> parseSnapshotResults(JsonNode response) {
        List<ScreenerResult> results = new ArrayList<>();
        if (response == null || !response.has("tickers")) {
            return results;
        }

        JsonNode tickers = response.get("tickers");
        int count = 0;
        for (JsonNode snapshot : tickers) {
            if (count >= 20) break;

            String ticker = textOrNull(snapshot, "ticker");
            // The snapshot API uses a flat structure with ticker at top level
            results.add(new ScreenerResult(
                    ticker,
                    null, // snapshot API doesn't include company name
                    null, // no exchange info in snapshot
                    "CS",
                    "us",
                    null, // no market cap in snapshot
                    "usd",
                    true
            ));
            count++;
        }
        return results;
    }

    // ──────────────────────────────── filtering ──────────────────────────────────

    /**
     * Post-filters screener results by market cap range when the API doesn't
     * support server-side market cap filtering.
     */
    private List<ScreenerResult> filterByMarketCap(
            List<ScreenerResult> results, BigDecimal min, BigDecimal max) {
        if (min == null && max == null) {
            return results;
        }

        return results.stream()
                .filter(r -> {
                    if (r.marketCap() == null) return false;
                    if (min != null && r.marketCap().compareTo(min) < 0) return false;
                    if (max != null && r.marketCap().compareTo(max) > 0) return false;
                    return true;
                })
                .toList();
    }

    // ──────────────────────────────── caching ────────────────────────────────────

    /**
     * Reads a cached screener result list from Redis.
     */
    private List<ScreenerResult> readCache(String key) {
        String json = redisTemplate.opsForValue().get(key);
        if (json == null) return null;
        try {
            return objectMapper.readValue(json, new TypeReference<List<ScreenerResult>>() {});
        } catch (JacksonException e) {
            log.warn("Evicted corrupted screener cache for key {}", key);
            redisTemplate.delete(key);
            return null;
        }
    }

    /**
     * Writes a screener result list to Redis with the specified TTL.
     */
    private void writeCache(String key, List<ScreenerResult> results, Duration ttl) {
        try {
            redisTemplate.opsForValue().set(key, objectMapper.writeValueAsString(results), ttl);
        } catch (JacksonException e) {
            log.error("Failed to cache screener results for key {}", key, e);
        }
    }

    /**
     * Produces a deterministic hash key for a {@link ScreenerCriteria} instance.
     */
    private String criteriaHash(ScreenerCriteria criteria) {
        String raw =
                (criteria.sector() != null ? criteria.sector().toLowerCase() : "") + "|" +
                (criteria.exchange() != null ? criteria.exchange().toUpperCase() : "") + "|" +
                (criteria.marketCapMin() != null ? criteria.marketCapMin().toPlainString() : "") + "|" +
                (criteria.marketCapMax() != null ? criteria.marketCapMax().toPlainString() : "") + "|" +
                (criteria.search() != null ? criteria.search().toLowerCase() : "") + "|" +
                criteria.sortBy() + "|" +
                criteria.order() + "|" +
                criteria.limit();
        return String.valueOf(raw.hashCode());
    }

    // ──────────────────────────────── JSON helpers ────────────────────────────────

    private String textOrNull(JsonNode node, String field) {
        return node.has(field) && !node.get(field).isNull() ? node.get(field).asText() : null;
    }

    private BigDecimal decimalOrNull(JsonNode node, String field) {
        if (!node.has(field) || node.get(field).isNull()) return null;
        return BigDecimal.valueOf(node.get(field).asDouble());
    }
}
