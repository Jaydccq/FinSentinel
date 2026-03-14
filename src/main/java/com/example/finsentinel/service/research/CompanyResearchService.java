package com.example.finsentinel.service.research;

import com.example.finsentinel.config.PolygonProperties;
import com.example.finsentinel.dto.research.AnalystConsensus;
import com.example.finsentinel.dto.research.CompanyProfile;
import com.example.finsentinel.dto.research.FinancialMetrics;
import tools.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.Duration;
import java.util.List;

/**
 * Retrieves and computes company fundamental research data.
 *
 * <p>Delegates data fetching (company profile, financial metrics) to the
 * configured {@link ResearchDataProvider} via the {@link ResearchDataProviderRegistry}.
 * Retains the analyst consensus computation which is derived logic that builds
 * on top of provider-fetched data.
 *
 * <p>All responses are cached in Redis to reduce API usage and improve latency.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CompanyResearchService {

    private final ResearchDataProviderRegistry providerRegistry;
    private final RestClient restClient;
    private final PolygonProperties polygonProperties;
    private final StringRedisTemplate redisTemplate;

    private static final MathContext MC = new MathContext(15, RoundingMode.HALF_UP);
    private static final int SCALE = 2;

    /**
     * Returns the default research data provider from the registry.
     */
    private ResearchDataProvider provider() {
        return providerRegistry.getDefaultProvider();
    }

    // ──────────────────────────── Company Profile ────────────────────────────

    /**
     * Fetches company profile via the configured research data provider.
     *
     * @param ticker stock ticker symbol (e.g. "AAPL")
     * @return company profile or {@code null} if the provider call fails
     */
    public CompanyProfile getCompanyProfile(String ticker) {
        return provider().getCompanyProfile(ticker);
    }

    // ──────────────────────────── Financial Metrics ──────────────────────────

    /**
     * Fetches financial statements via the configured research data provider.
     *
     * @param ticker stock ticker symbol
     * @param limit  number of filing periods to retrieve (max 10)
     * @return list of financial metrics per filing period, or empty list on failure
     */
    public List<FinancialMetrics> getFinancialMetrics(String ticker, int limit) {
        return provider().getFinancialMetrics(ticker, limit);
    }

    // ──────────────────────────── Analyst Consensus ──────────────────────────

    /**
     * Computes analyst consensus estimates from financial metrics and current price.
     *
     * <p>Uses a simple heuristic: low PE + high growth = BUY, high PE + low growth = SELL.
     * Target prices are derived from expected return estimates. Always includes a
     * disclaimer that values are computed, not from real analyst data.
     *
     * @param ticker stock ticker symbol
     * @return computed analyst consensus, or {@code null} on failure
     */
    public AnalystConsensus getAnalystConsensus(String ticker) {
        ticker = ticker.toUpperCase().trim();

        try {
            // Get current price from Polygon
            BigDecimal currentPrice = fetchCurrentPrice(ticker);
            if (currentPrice == null || currentPrice.compareTo(BigDecimal.ZERO) <= 0) {
                log.warn("Cannot compute analyst consensus without current price for {}", ticker);
                return null;
            }

            // Get most recent financial metrics
            List<FinancialMetrics> metrics = getFinancialMetrics(ticker, 4);
            if (metrics.isEmpty()) {
                log.warn("Cannot compute analyst consensus without financial data for {}", ticker);
                return null;
            }

            FinancialMetrics latest = metrics.getFirst();
            BigDecimal peRatio = latest.peRatio();
            BigDecimal revenueGrowth = latest.revenueGrowth();
            BigDecimal netMargin = latest.netMargin();

            // Score-based recommendation (higher = more bullish)
            double score = 0.0;

            // PE ratio factor: lower PE = more attractive
            if (peRatio != null && peRatio.compareTo(BigDecimal.ZERO) > 0) {
                if (peRatio.doubleValue() < 15) score += 2.0;
                else if (peRatio.doubleValue() < 25) score += 1.0;
                else if (peRatio.doubleValue() < 40) score += 0.0;
                else score -= 1.0;
            }

            // Revenue growth factor: higher growth = more attractive
            if (revenueGrowth != null) {
                if (revenueGrowth.doubleValue() > 20) score += 2.0;
                else if (revenueGrowth.doubleValue() > 10) score += 1.0;
                else if (revenueGrowth.doubleValue() > 0) score += 0.5;
                else score -= 1.0;
            }

            // Net margin factor: healthy margins = quality business
            if (netMargin != null) {
                if (netMargin.doubleValue() > 20) score += 1.0;
                else if (netMargin.doubleValue() > 10) score += 0.5;
                else if (netMargin.doubleValue() > 0) score += 0.0;
                else score -= 1.0;
            }

            // Map score to recommendation
            String recommendation;
            double expectedReturn;
            if (score >= 4.0) {
                recommendation = "STRONG_BUY";
                expectedReturn = 0.30;
            } else if (score >= 2.0) {
                recommendation = "BUY";
                expectedReturn = 0.15;
            } else if (score >= 0.0) {
                recommendation = "HOLD";
                expectedReturn = 0.05;
            } else if (score >= -2.0) {
                recommendation = "SELL";
                expectedReturn = -0.10;
            } else {
                recommendation = "STRONG_SELL";
                expectedReturn = -0.20;
            }

            // Compute target prices
            BigDecimal median = currentPrice.multiply(
                    BigDecimal.ONE.add(BigDecimal.valueOf(expectedReturn)), MC
            ).setScale(SCALE, RoundingMode.HALF_UP);

            BigDecimal high = median.multiply(BigDecimal.valueOf(1.20), MC)
                    .setScale(SCALE, RoundingMode.HALF_UP);
            BigDecimal low = median.multiply(BigDecimal.valueOf(0.80), MC)
                    .setScale(SCALE, RoundingMode.HALF_UP);

            BigDecimal upsidePotential = median.subtract(currentPrice)
                    .divide(currentPrice, 4, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(100))
                    .setScale(SCALE, RoundingMode.HALF_UP);

            return new AnalystConsensus(
                    ticker,
                    recommendation,
                    high,
                    low,
                    median,
                    currentPrice,
                    upsidePotential,
                    "Computed from financial metrics (PE ratio, revenue growth, net margin). " +
                            "These are heuristic estimates, NOT real analyst consensus data."
            );

        } catch (Exception e) {
            log.error("Failed to compute analyst consensus for {}", ticker, e);
            return null;
        }
    }

    // ──────────────────────────── Private Helpers ────────────────────────────

    /**
     * Fetches the current closing price for a ticker from Polygon.io previous-close endpoint.
     * Kept here because it is used by {@code getAnalystConsensus()} which is computed logic,
     * not a provider-level concern.
     */
    private BigDecimal fetchCurrentPrice(String ticker) {
        String cacheKey = "research:price:" + ticker;
        String cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            try {
                return new BigDecimal(cached);
            } catch (NumberFormatException e) {
                redisTemplate.delete(cacheKey);
            }
        }

        try {
            JsonNode response = restClient.get()
                    .uri(polygonProperties.getBaseUrl() +
                                    "/v2/aggs/ticker/{ticker}/prev?apiKey={apiKey}",
                            ticker, polygonProperties.getApiKey())
                    .retrieve()
                    .body(JsonNode.class);

            if (response != null && response.has("results") && !response.get("results").isEmpty()) {
                double close = response.get("results").get(0).path("c").asDouble(0);
                if (close > 0) {
                    BigDecimal price = BigDecimal.valueOf(close).setScale(SCALE, RoundingMode.HALF_UP);
                    redisTemplate.opsForValue().set(cacheKey, price.toPlainString(),
                            Duration.ofMinutes(15));
                    return price;
                }
            }
        } catch (Exception e) {
            log.warn("Failed to fetch current price for {}: {}", ticker, e.getMessage());
        }
        return null;
    }
}
