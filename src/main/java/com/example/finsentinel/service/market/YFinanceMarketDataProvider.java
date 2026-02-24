package com.example.finsentinel.service.market;

import com.example.finsentinel.config.YahooFinanceProperties;
import com.example.finsentinel.dto.market.MarketBar;
import com.example.finsentinel.dto.market.MarketQuote;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * Yahoo Finance implementation of the {@link MarketDataProvider} interface.
 *
 * <p>Uses the Yahoo Finance v8 chart API which is free and requires no API key,
 * making it the most accessible market data source for any user.
 *
 * <p>Follows the OpenBB Fetcher three-phase pattern:
 * <ul>
 *   <li><b>transformQuery</b> -- ticker validation (handled at service layer)</li>
 *   <li><b>extractData</b> -- calls Yahoo Finance v8 chart endpoint</li>
 *   <li><b>transformData</b> -- maps Yahoo Finance JSON parallel arrays into
 *       standardized {@link MarketQuote} and {@link MarketBar} records</li>
 * </ul>
 *
 * <p>Yahoo Finance blocks requests without a proper {@code User-Agent} header,
 * so every request includes a browser-like user agent string.
 *
 * <p>This component is responsible only for HTTP transport and data transformation.
 * Caching is handled externally by {@link com.example.finsentinel.service.MarketDataService}.
 */
@Component
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(name = "app.yahoo-finance.enabled", havingValue = "true", matchIfMissing = true)
public class YFinanceMarketDataProvider implements MarketDataProvider {

    private static final String USER_AGENT = "Mozilla/5.0 (compatible; FinSentinel/1.0)";

    private final RestClient restClient;
    private final YahooFinanceProperties yahooProperties;
    private final ObjectMapper objectMapper;

    @Override
    public String getName() {
        return "yfinance";
    }

    /**
     * Fetches the latest daily data from Yahoo Finance and transforms it into a {@link MarketQuote}.
     *
     * <p><b>extractData:</b> Requests the most recent 1-day chart with daily interval.
     * <br><b>transformData:</b> Uses {@code meta.regularMarketPrice} for the close price
     * and the latest entry from {@code indicators.quote[0]} arrays for OHLV data.
     *
     * @param ticker normalized ticker symbol (e.g. AAPL)
     * @return standardized market quote
     * @throws IllegalArgumentException if Yahoo Finance returns an error or no data
     */
    @Override
    public MarketQuote getQuote(String ticker) {
        JsonNode result = fetchChart(ticker, "1d");
        return transformToQuote(ticker, result);
    }

    /**
     * Fetches historical daily bars from Yahoo Finance and transforms them into {@link MarketBar} records.
     *
     * <p><b>extractData:</b> Maps the requested day count to a Yahoo Finance range string
     * ({@code 1mo}, {@code 3mo}, {@code 6mo}, {@code 1y}) and fetches daily-interval data.
     * <br><b>transformData:</b> Iterates through parallel arrays (timestamp, open, high, low,
     * close, volume) and constructs a bar for each valid index.
     *
     * @param ticker normalized ticker symbol
     * @param days   number of calendar days of history (clamped to [1, 365])
     * @return list of bars ordered ascending by timestamp
     * @throws IllegalArgumentException if Yahoo Finance returns an error or no data
     */
    @Override
    public List<MarketBar> getHistoricalBars(String ticker, int days) {
        String range = mapDaysToRange(days);
        JsonNode result = fetchChart(ticker, range);
        return transformToBars(result);
    }

    // ──────────────────────────────── extractData ────────────────────────────────

    /**
     * Calls the Yahoo Finance v8 chart API and extracts the first result node.
     *
     * <p>The response structure is:
     * <pre>{@code
     * { "chart": { "result": [ { ... } ], "error": null } }
     * }</pre>
     *
     * @param ticker ticker symbol
     * @param range  Yahoo Finance range string (e.g. "1d", "1mo", "3mo")
     * @return the first element of {@code chart.result}
     * @throws IllegalArgumentException if the response contains an error or no result
     */
    private JsonNode fetchChart(String ticker, String range) {
        String url = yahooProperties.getBaseUrl()
                + "/v8/finance/chart/" + ticker
                + "?range=" + range + "&interval=1d";

        log.debug("Fetching Yahoo Finance chart: {}", url);

        String responseBody = restClient.get()
                .uri(url)
                .header("User-Agent", USER_AGENT)
                .retrieve()
                .body(String.class);

        if (responseBody == null || responseBody.isBlank()) {
            throw new IllegalArgumentException("Empty response from Yahoo Finance for " + ticker);
        }

        JsonNode root = objectMapper.readTree(responseBody);
        JsonNode chart = root.get("chart");

        if (chart == null) {
            throw new IllegalArgumentException("Invalid Yahoo Finance response for " + ticker);
        }

        // Check for API-level errors
        JsonNode error = chart.get("error");
        if (error != null && !error.isNull()) {
            String errorMsg = error.has("description")
                    ? error.get("description").asText()
                    : error.toString();
            throw new IllegalArgumentException(
                    "Yahoo Finance error for " + ticker + ": " + errorMsg);
        }

        JsonNode resultArray = chart.get("result");
        if (resultArray == null || resultArray.isEmpty()) {
            throw new IllegalArgumentException("No chart data from Yahoo Finance for " + ticker);
        }

        return resultArray.get(0);
    }

    // ──────────────────────────────── transformData ──────────────────────────────

    /**
     * Transforms a Yahoo Finance chart result node into a standardized {@link MarketQuote}.
     *
     * <p>The close price is taken from {@code meta.regularMarketPrice} for maximum accuracy.
     * Open, high, low, and volume are taken from the last entry in the {@code indicators.quote[0]}
     * parallel arrays. The timestamp is taken from the last entry in the {@code timestamp} array.
     *
     * @param ticker ticker symbol
     * @param result Yahoo Finance chart result node
     * @return standardized quote record
     */
    private MarketQuote transformToQuote(String ticker, JsonNode result) {
        JsonNode meta = result.get("meta");
        BigDecimal close = BigDecimal.valueOf(meta.get("regularMarketPrice").asDouble());

        JsonNode timestamps = result.get("timestamp");
        JsonNode quote = result.get("indicators").get("quote").get(0);

        // Use the last available entry in the arrays
        int lastIdx = timestamps.size() - 1;

        BigDecimal open = safeDecimal(quote.get("open"), lastIdx);
        BigDecimal high = safeDecimal(quote.get("high"), lastIdx);
        BigDecimal low = safeDecimal(quote.get("low"), lastIdx);
        long volume = safeLong(quote.get("volume"), lastIdx);
        long timestamp = timestamps.get(lastIdx).asLong() * 1000L;

        return new MarketQuote(ticker, open, high, low, close, volume, timestamp);
    }

    /**
     * Transforms a Yahoo Finance chart result node into a list of standardized {@link MarketBar} records.
     *
     * <p>Yahoo Finance returns parallel arrays: {@code timestamp[]}, {@code open[]}, {@code high[]},
     * {@code low[]}, {@code close[]}, {@code volume[]}. Each index in these arrays corresponds to
     * the same trading day. Null entries (market holidays within the range) are skipped with a
     * warning logged.
     *
     * @param result Yahoo Finance chart result node
     * @return list of market bars ordered ascending by timestamp
     */
    private List<MarketBar> transformToBars(JsonNode result) {
        JsonNode timestamps = result.get("timestamp");
        JsonNode quote = result.get("indicators").get("quote").get(0);

        JsonNode opens = quote.get("open");
        JsonNode highs = quote.get("high");
        JsonNode lows = quote.get("low");
        JsonNode closes = quote.get("close");
        JsonNode volumes = quote.get("volume");

        List<MarketBar> bars = new ArrayList<>();

        for (int i = 0; i < timestamps.size(); i++) {
            // Skip entries where any OHLC value is null (market holidays)
            if (opens.get(i).isNull() || highs.get(i).isNull()
                    || lows.get(i).isNull() || closes.get(i).isNull()) {
                log.debug("Skipping null bar at index {} (likely market holiday)", i);
                continue;
            }

            bars.add(new MarketBar(
                    BigDecimal.valueOf(opens.get(i).asDouble()),
                    BigDecimal.valueOf(highs.get(i).asDouble()),
                    BigDecimal.valueOf(lows.get(i).asDouble()),
                    BigDecimal.valueOf(closes.get(i).asDouble()),
                    safeLong(volumes, i),
                    timestamps.get(i).asLong() * 1000L
            ));
        }

        return bars;
    }

    // ──────────────────────────────── helpers ────────────────────────────────────

    /**
     * Maps a day count to the closest Yahoo Finance range string.
     *
     * @param days number of calendar days requested
     * @return Yahoo Finance range parameter value
     */
    private String mapDaysToRange(int days) {
        if (days <= 30) return "1mo";
        if (days <= 90) return "3mo";
        if (days <= 180) return "6mo";
        return "1y";
    }

    /**
     * Safely extracts a {@link BigDecimal} from a JSON array at the given index,
     * returning {@link BigDecimal#ZERO} if the value is null.
     *
     * @param array JSON array node
     * @param index array index
     * @return the decimal value, or zero if null
     */
    private BigDecimal safeDecimal(JsonNode array, int index) {
        JsonNode node = array.get(index);
        if (node == null || node.isNull()) {
            return BigDecimal.ZERO;
        }
        return BigDecimal.valueOf(node.asDouble());
    }

    /**
     * Safely extracts a {@code long} from a JSON array at the given index,
     * returning {@code 0L} if the value is null.
     *
     * @param array JSON array node
     * @param index array index
     * @return the long value, or zero if null
     */
    private long safeLong(JsonNode array, int index) {
        JsonNode node = array.get(index);
        if (node == null || node.isNull()) {
            return 0L;
        }
        return node.asLong();
    }
}
