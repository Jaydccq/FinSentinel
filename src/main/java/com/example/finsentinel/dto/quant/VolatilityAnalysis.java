package com.example.finsentinel.dto.quant;

/**
 * Volatility regime analysis with rolling window decomposition.
 *
 * <p>Compares recent (20-day) annualized volatility against the full historical
 * period and classifies the current environment into a regime. The rolling
 * volatility array enables trend visualization on the frontend.
 *
 * @param currentVolatility     recent 20-day annualized volatility (decimal, e.g., 0.25 = 25%)
 * @param historicalVolatility  full-period annualized volatility
 * @param volatilityPercentile  percentile rank of current vol within the rolling distribution (0-100)
 * @param regime                regime classification: LOW, NORMAL, HIGH, or EXTREME
 * @param rollingVolatility     array of rolling 20-day annualized volatility values for trend analysis
 */
public record VolatilityAnalysis(
        double currentVolatility,
        double historicalVolatility,
        double volatilityPercentile,
        String regime,
        double[] rollingVolatility
) {}
