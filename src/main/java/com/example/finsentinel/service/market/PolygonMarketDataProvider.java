package com.example.finsentinel.service.market;

import com.example.finsentinel.config.PolygonProperties;
import com.example.finsentinel.dto.market.MarketBar;
import com.example.finsentinel.dto.market.MarketQuote;
import tools.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/**
 * Polygon.io implementation of the {@link MarketDataProvider} interface.
 *
 * <p>Follows the OpenBB Fetcher three-phase pattern:
 * <ul>
 *   <li><b>transformQuery</b> -- ticker validation (handled at service layer)</li>
 *   <li><b>extractData</b> -- calls Polygon aggregate bars API</li>
 *   <li><b>transformData</b> -- maps Polygon JSON fields ({@code o,h,l,c,v,t}) into
 *       standardized {@link MarketQuote} and {@link MarketBar} records</li>
 * </ul>
 *
 * <p>This component is responsible only for HTTP transport and data transformation.
 * Caching is handled externally by {@link com.example.finsentinel.service.MarketDataService}.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class PolygonMarketDataProvider implements MarketDataProvider {

    private final RestClient restClient;
    private final PolygonProperties polygonProperties;

    @Override
    public String getName() {
        return "polygon";
    }

    /**
     * Fetches the latest daily bar from Polygon and transforms it into a {@link MarketQuote}.
     *
     * <p><b>extractData:</b> Requests the most recent 1 bar (descending) from the last 5 days
     * to handle weekends/holidays.
     * <br><b>transformData:</b> Maps Polygon fields {@code o,h,l,c,v,t} to
     * {@link BigDecimal}-backed quote fields.
     *
     * @param ticker normalized ticker symbol
     * @return standardized market quote
     * @throws IllegalArgumentException if Polygon returns no data
     */
    @Override
    public MarketQuote getQuote(String ticker) {
        JsonNode bar = fetchLatestBar(ticker);
        return transformToQuote(ticker, bar);
    }

    /**
     * Fetches historical daily bars from Polygon and transforms them into {@link MarketBar} records.
     *
     * <p><b>extractData:</b> Requests ascending bars from {@code today - days} to today.
     * <br><b>transformData:</b> Maps each Polygon result node into a standardized bar.
     *
     * @param ticker normalized ticker symbol
     * @param days   number of calendar days (pre-clamped by caller)
     * @return list of bars ordered ascending by timestamp
     * @throws IllegalArgumentException if Polygon returns no results
     */
    @Override
    public List<MarketBar> getHistoricalBars(String ticker, int days) {
        String to = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);
        String from = LocalDate.now().minusDays(days).format(DateTimeFormatter.ISO_LOCAL_DATE);

        JsonNode response = callPolygonAggs(ticker, from, to, "asc", days + 10);

        if (response == null || !response.has("results")) {
            throw new IllegalArgumentException("No historical data for " + ticker);
        }

        return transformToBars(response.get("results"));
    }

    // ──────────────────────────────── extractData ────────────────────────────────

    /**
     * Loads the most recent available daily bar for a ticker from Polygon.
     *
     * @param ticker normalized ticker symbol
     * @return latest daily aggregate bar JSON node
     * @throws IllegalArgumentException if no market data is returned
     */
    private JsonNode fetchLatestBar(String ticker) {
        String today = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);
        String from = LocalDate.now().minusDays(5).format(DateTimeFormatter.ISO_LOCAL_DATE);

        JsonNode response = callPolygonAggs(ticker, from, today, "desc", 1);

        if (response == null || !response.has("results") || response.get("results").isEmpty()) {
            throw new IllegalArgumentException("No market data available for " + ticker);
        }

        return response.get("results").get(0);
    }

    /**
     * Executes a Polygon aggregate-bars HTTP request.
     *
     * @param ticker ticker symbol
     * @param from   start date in ISO-8601 format
     * @param to     end date in ISO-8601 format
     * @param sort   result sort direction
     * @param limit  max number of bars to return
     * @return parsed JSON response node
     */
    private JsonNode callPolygonAggs(String ticker, String from, String to, String sort, int limit) {
        return restClient.get()
                .uri(polygonProperties.getBaseUrl()
                                + "/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}?adjusted=true&sort={sort}&limit={limit}&apiKey={apiKey}",
                        ticker, from, to, sort, limit, polygonProperties.getApiKey())
                .retrieve()
                .body(JsonNode.class);
    }

    // ──────────────────────────────── transformData ──────────────────────────────

    /**
     * Transforms a single Polygon bar JSON node into a standardized {@link MarketQuote}.
     *
     * @param ticker ticker symbol
     * @param bar    Polygon aggregate bar node
     * @return standardized quote record
     */
    private MarketQuote transformToQuote(String ticker, JsonNode bar) {
        return new MarketQuote(
                ticker,
                BigDecimal.valueOf(bar.get("o").asDouble()),
                BigDecimal.valueOf(bar.get("h").asDouble()),
                BigDecimal.valueOf(bar.get("l").asDouble()),
                BigDecimal.valueOf(bar.get("c").asDouble()),
                bar.get("v").asLong(),
                bar.get("t").asLong()
        );
    }

    /**
     * Transforms a Polygon results JSON array into a list of standardized {@link MarketBar} records.
     *
     * @param results Polygon "results" array node
     * @return list of market bars ordered as received
     */
    private List<MarketBar> transformToBars(JsonNode results) {
        List<MarketBar> bars = new ArrayList<>();
        for (JsonNode node : results) {
            bars.add(new MarketBar(
                    BigDecimal.valueOf(node.get("o").asDouble()),
                    BigDecimal.valueOf(node.get("h").asDouble()),
                    BigDecimal.valueOf(node.get("l").asDouble()),
                    BigDecimal.valueOf(node.get("c").asDouble()),
                    node.get("v").asLong(),
                    node.get("t").asLong()
            ));
        }
        return bars;
    }
}
