package com.example.finsentinel.service.market;

import com.example.finsentinel.dto.market.MarketBar;
import com.example.finsentinel.dto.market.MarketQuote;

import java.util.List;

/**
 * Provider interface for market data retrieval, inspired by the OpenBB Fetcher pattern.
 *
 * <p>Each implementation encapsulates the three-phase pipeline:
 * <ol>
 *   <li><b>transformQuery</b> -- validate and normalize the ticker symbol</li>
 *   <li><b>extractData</b> -- call the upstream API (Polygon, Alpha Vantage, etc.)</li>
 *   <li><b>transformData</b> -- convert provider-specific JSON into standardized DTOs</li>
 * </ol>
 *
 * <p>Implementations are discovered via Spring dependency injection and registered
 * automatically in {@link MarketDataProviderRegistry}.
 */
public interface MarketDataProvider {

    /**
     * Returns the unique name of this provider (e.g. "polygon", "alphavantage").
     *
     * <p>Used by {@link MarketDataProviderRegistry} for lookup and configuration
     * via {@code app.market.default-provider}.
     *
     * @return provider name, lower-case by convention
     */
    String getName();

    /**
     * Fetches the most recent real-time quote for the given ticker.
     *
     * @param ticker normalized stock ticker symbol (e.g. AAPL)
     * @return standardized quote snapshot
     * @throws IllegalArgumentException if the ticker is invalid or no data is available
     */
    MarketQuote getQuote(String ticker);

    /**
     * Fetches historical daily OHLCV bars for the given ticker.
     *
     * @param ticker normalized stock ticker symbol
     * @param days   number of calendar days of history (clamped to [1, 365])
     * @return list of bars ordered ascending by timestamp
     * @throws IllegalArgumentException if the ticker is invalid or no data is available
     */
    List<MarketBar> getHistoricalBars(String ticker, int days);

    /**
     * Checks whether this provider can service requests for the given ticker.
     *
     * <p>Default implementation accepts all tickers. Override to restrict support
     * to specific exchanges, asset classes, or regions.
     *
     * @param ticker stock ticker symbol
     * @return {@code true} if this provider can handle the ticker
     */
    default boolean supports(String ticker) {
        return true;
    }
}
