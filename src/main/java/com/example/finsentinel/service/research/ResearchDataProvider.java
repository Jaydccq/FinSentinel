package com.example.finsentinel.service.research;

import com.example.finsentinel.dto.research.CompanyProfile;
import com.example.finsentinel.dto.research.FinancialMetrics;

import java.util.List;

/**
 * Provider interface for company research and fundamental data retrieval.
 *
 * <p>Each implementation encapsulates the three-phase pipeline:
 * <ol>
 *   <li><b>transformQuery</b> -- validate and normalize the ticker symbol</li>
 *   <li><b>extractData</b> -- call the upstream API (Polygon, yfinance, etc.)</li>
 *   <li><b>transformData</b> -- convert provider-specific JSON into standardized DTOs</li>
 * </ol>
 *
 * <p>Implementations are discovered via Spring dependency injection and registered
 * automatically in {@link ResearchDataProviderRegistry}.
 */
public interface ResearchDataProvider {

    /**
     * Returns the unique name of this provider (e.g. "polygon", "yfinance").
     *
     * <p>Used by {@link ResearchDataProviderRegistry} for lookup and configuration
     * via {@code app.research.default-provider}.
     *
     * @return provider name, lower-case by convention
     */
    String getName();

    /**
     * Fetches the company profile for the given ticker.
     *
     * @param ticker normalized stock ticker symbol (e.g. AAPL)
     * @return standardized company profile
     * @throws IllegalArgumentException if the ticker is invalid or no data is available
     */
    CompanyProfile getCompanyProfile(String ticker);

    /**
     * Fetches historical financial metrics (income statement, balance sheet,
     * cash flow) for the given ticker.
     *
     * @param ticker  normalized stock ticker symbol
     * @param periods number of fiscal periods to retrieve (clamped to [1, 20])
     * @return list of financial metrics ordered by most recent first
     * @throws IllegalArgumentException if the ticker is invalid or no data is available
     */
    List<FinancialMetrics> getFinancialMetrics(String ticker, int periods);

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
