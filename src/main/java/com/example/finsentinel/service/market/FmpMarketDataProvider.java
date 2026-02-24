package com.example.finsentinel.service.market;

import com.example.finsentinel.config.FmpProperties;
import com.example.finsentinel.dto.market.MarketBar;
import com.example.finsentinel.dto.market.MarketQuote;
import tools.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Financial Modeling Prep (FMP) implementation of the {@link MarketDataProvider} interface.
 *
 * <p>FMP is the richest data source in the provider registry: it provides standard
 * OHLCV market data (quotes, historical bars) <em>and</em> fundamental financial data
 * (balance sheets, income statements, key metrics, company profiles) that no other
 * provider currently offers.
 *
 * <p>Follows the OpenBB Fetcher three-phase pattern:
 * <ul>
 *   <li><b>transformQuery</b> -- ticker validation (handled at service layer)</li>
 *   <li><b>extractData</b> -- calls FMP REST API endpoints</li>
 *   <li><b>transformData</b> -- maps FMP JSON fields into standardized
 *       {@link MarketQuote} and {@link MarketBar} records</li>
 * </ul>
 *
 * <p>This bean is conditionally registered only when {@code app.fmp.enabled=true},
 * since a paid API key is required.
 *
 * <h4>Additional (non-interface) methods:</h4>
 * <p>The fundamental data methods ({@link #getCompanyProfileRaw},
 * {@link #getKeyMetricsRaw}, {@link #getBalanceSheetRaw},
 * {@link #getIncomeStatementRaw}) return raw {@link JsonNode} objects for maximum
 * flexibility. They are designed to be consumed by higher-level services such as
 * a future {@code CompanyResearchService}.
 */
@Component
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(name = "app.fmp.enabled", havingValue = "true")
public class FmpMarketDataProvider implements MarketDataProvider {

    private final RestClient restClient;
    private final FmpProperties fmpProperties;

    @Override
    public String getName() {
        return "fmp";
    }

    // ──────────────────────────────── Market Data (interface) ─────────────────────

    /**
     * Fetches the most recent real-time quote from FMP and transforms it into a
     * standardized {@link MarketQuote}.
     *
     * <p><b>extractData:</b> Calls {@code /quote/{ticker}} which returns a JSON array.
     * <br><b>transformData:</b> Maps FMP fields
     * ({@code price, open, dayHigh, dayLow, volume, timestamp}) into
     * {@link BigDecimal}-backed quote fields. The FMP timestamp is in Unix seconds
     * and is converted to milliseconds.
     *
     * @param ticker normalized ticker symbol (e.g. AAPL)
     * @return standardized market quote
     * @throws IllegalArgumentException if FMP returns no data for the ticker
     */
    @Override
    public MarketQuote getQuote(String ticker) {
        JsonNode response = callFmpApi("/quote/" + ticker);

        if (response == null || response.isEmpty()) {
            throw new IllegalArgumentException("No market data available from FMP for " + ticker);
        }

        JsonNode quote = response.get(0);
        return new MarketQuote(
                ticker,
                BigDecimal.valueOf(quote.get("open").asDouble()),
                BigDecimal.valueOf(quote.get("dayHigh").asDouble()),
                BigDecimal.valueOf(quote.get("dayLow").asDouble()),
                BigDecimal.valueOf(quote.get("price").asDouble()),
                quote.get("volume").asLong(),
                quote.get("timestamp").asLong() * 1000L
        );
    }

    /**
     * Fetches historical daily OHLCV bars from FMP and transforms them into
     * standardized {@link MarketBar} records.
     *
     * <p><b>extractData:</b> Calls {@code /historical-price-full/{ticker}} with
     * {@code from} and {@code to} date parameters.
     * <br><b>transformData:</b> Maps each entry in the {@code historical} array.
     * FMP date strings are ISO format ("2024-02-19") and are converted to epoch
     * milliseconds at start-of-day UTC.
     *
     * <p><b>Important:</b> FMP returns historical data in newest-first order.
     * The result list is reversed to satisfy the interface contract of ascending
     * timestamp order.
     *
     * @param ticker normalized ticker symbol
     * @param days   number of calendar days of history
     * @return list of bars ordered ascending by timestamp
     * @throws IllegalArgumentException if FMP returns no historical data
     */
    @Override
    public List<MarketBar> getHistoricalBars(String ticker, int days) {
        String to = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);
        String from = LocalDate.now().minusDays(days).format(DateTimeFormatter.ISO_LOCAL_DATE);

        JsonNode response = callFmpApi("/historical-price-full/" + ticker
                + "?from=" + from + "&to=" + to);

        if (response == null || !response.has("historical") || response.get("historical").isEmpty()) {
            throw new IllegalArgumentException("No historical data from FMP for " + ticker);
        }

        List<MarketBar> bars = new ArrayList<>();
        for (JsonNode node : response.get("historical")) {
            LocalDate date = LocalDate.parse(node.get("date").asText(), DateTimeFormatter.ISO_LOCAL_DATE);
            long timestampMillis = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();

            bars.add(new MarketBar(
                    BigDecimal.valueOf(node.get("open").asDouble()),
                    BigDecimal.valueOf(node.get("high").asDouble()),
                    BigDecimal.valueOf(node.get("low").asDouble()),
                    BigDecimal.valueOf(node.get("close").asDouble()),
                    node.get("volume").asLong(),
                    timestampMillis
            ));
        }

        // FMP returns newest-first; reverse to ascending order per interface contract
        Collections.reverse(bars);
        return bars;
    }

    // ──────────────────────────── Fundamental Data (FMP-specific) ─────────────────

    /**
     * Fetches the company profile for a ticker as raw JSON.
     *
     * <p>Endpoint: {@code /profile/{ticker}}. Returns data such as company name,
     * description, sector, industry, market cap, CEO, number of employees, etc.
     *
     * @param ticker stock ticker symbol
     * @return raw JSON array (first element is the profile), or {@code null} on failure
     */
    public JsonNode getCompanyProfileRaw(String ticker) {
        return callFmpApi("/profile/" + ticker);
    }

    /**
     * Fetches key financial metrics for a ticker as raw JSON.
     *
     * <p>Endpoint: {@code /key-metrics/{ticker}?period=annual&limit={limit}}.
     * Returns metrics such as PE ratio, PB ratio, dividend yield, ROE, ROA,
     * debt-to-equity, revenue per share, etc.
     *
     * @param ticker stock ticker symbol
     * @param limit  maximum number of annual periods to return
     * @return raw JSON array of key metrics, or {@code null} on failure
     */
    public JsonNode getKeyMetricsRaw(String ticker, int limit) {
        return callFmpApi("/key-metrics/" + ticker + "?period=annual&limit=" + limit);
    }

    /**
     * Fetches balance sheet statements for a ticker as raw JSON.
     *
     * <p>Endpoint: {@code /balance-sheet-statement/{ticker}?period={period}&limit={limit}}.
     * Returns total assets, liabilities, equity, cash, debt, etc.
     *
     * @param ticker stock ticker symbol
     * @param period reporting period: {@code "annual"} or {@code "quarter"}
     * @param limit  maximum number of periods to return
     * @return raw JSON array of balance sheet statements, or {@code null} on failure
     */
    public JsonNode getBalanceSheetRaw(String ticker, String period, int limit) {
        return callFmpApi("/balance-sheet-statement/" + ticker
                + "?period=" + period + "&limit=" + limit);
    }

    /**
     * Fetches income statements for a ticker as raw JSON.
     *
     * <p>Endpoint: {@code /income-statement/{ticker}?period={period}&limit={limit}}.
     * Returns revenue, gross profit, operating income, net income, EPS, etc.
     *
     * @param ticker stock ticker symbol
     * @param period reporting period: {@code "annual"} or {@code "quarter"}
     * @param limit  maximum number of periods to return
     * @return raw JSON array of income statements, or {@code null} on failure
     */
    public JsonNode getIncomeStatementRaw(String ticker, String period, int limit) {
        return callFmpApi("/income-statement/" + ticker
                + "?period=" + period + "&limit=" + limit);
    }

    // ──────────────────────────────── Internal helpers ────────────────────────────

    /**
     * Executes a GET request against the FMP API and returns the parsed JSON response.
     *
     * <p>Appends the API key as a query parameter. If the path already contains
     * query parameters ({@code ?}), the key is appended with {@code &}; otherwise
     * it is appended with {@code ?}.
     *
     * @param path API path relative to the base URL (e.g. {@code /quote/AAPL})
     * @return parsed JSON response, or {@code null} if the request fails
     */
    private JsonNode callFmpApi(String path) {
        try {
            String separator = path.contains("?") ? "&" : "?";
            String url = fmpProperties.getBaseUrl() + path + separator + "apikey=" + fmpProperties.getApiKey();
            return restClient.get()
                    .uri(url)
                    .retrieve()
                    .body(JsonNode.class);
        } catch (Exception e) {
            log.error("FMP API call failed: {}", path, e);
            return null;
        }
    }
}
