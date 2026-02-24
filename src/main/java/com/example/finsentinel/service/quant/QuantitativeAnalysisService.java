package com.example.finsentinel.service.quant;

import com.example.finsentinel.dto.quant.ReturnStatistics;
import com.example.finsentinel.dto.quant.ValueAtRisk;
import com.example.finsentinel.dto.quant.VolatilityAnalysis;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.math3.stat.correlation.PearsonsCorrelation;
import org.apache.commons.math3.stat.descriptive.DescriptiveStatistics;
import org.apache.commons.math3.stat.descriptive.moment.Kurtosis;
import org.apache.commons.math3.stat.descriptive.moment.Skewness;
import org.springframework.stereotype.Service;

import java.util.Arrays;

/**
 * Stateless quantitative analytics service inspired by OpenBB's Quantitative Extension.
 *
 * <p>Provides statistical risk calculations — return statistics, Value at Risk,
 * volatility regime analysis, and cross-asset correlation — using Apache Commons Math 3.
 * All methods accept raw closing price arrays and return structured analysis records.
 *
 * <p>Conventions:
 * <ul>
 *   <li>Returns are log returns: {@code ln(price[i] / price[i-1])}</li>
 *   <li>Annualization uses 252 trading days per year</li>
 *   <li>Risk-free rate is 5% annual (US Treasury proxy)</li>
 * </ul>
 */
@Service
@Slf4j
public class QuantitativeAnalysisService {

    private static final int TRADING_DAYS_PER_YEAR = 252;
    private static final double RISK_FREE_RATE = 0.05;
    private static final double SQRT_252 = Math.sqrt(TRADING_DAYS_PER_YEAR);
    private static final int ROLLING_WINDOW = 20;

    // Z-scores for parametric VaR
    private static final double Z_95 = 1.645;
    private static final double Z_99 = 2.326;

    /**
     * Calculates comprehensive return statistics for a price series.
     *
     * @param closePrices array of daily closing prices (oldest first)
     * @return return statistics including annualized metrics, distribution shape, and drawdown
     * @throws IllegalArgumentException if fewer than 30 prices are provided
     */
    public ReturnStatistics calculateReturnStatistics(double[] closePrices) {
        validateMinimumDataPoints(closePrices, 30);

        double[] returns = calculateLogReturns(closePrices);

        DescriptiveStatistics stats = new DescriptiveStatistics(returns);
        double meanReturn = stats.getMean();
        double stdDev = stats.getStandardDeviation();

        double annualizedReturn = meanReturn * TRADING_DAYS_PER_YEAR;
        double annualizedVol = stdDev * SQRT_252;

        double skewness = new Skewness().evaluate(returns);
        double kurtosis = new Kurtosis().evaluate(returns);

        double maxDrawdown = calculateMaxDrawdown(closePrices);

        double sharpeRatio = annualizedVol == 0.0
                ? 0.0
                : (annualizedReturn - RISK_FREE_RATE) / annualizedVol;

        return new ReturnStatistics(
                meanReturn,
                annualizedReturn,
                stdDev,
                annualizedVol,
                skewness,
                kurtosis,
                maxDrawdown,
                sharpeRatio,
                returns.length
        );
    }

    /**
     * Calculates Value at Risk and Conditional VaR using the specified method.
     *
     * @param closePrices array of daily closing prices (oldest first)
     * @param method      "historical" for empirical quantile or "parametric" for normal assumption
     * @return VaR and CVaR at 95% and 99% confidence levels
     * @throws IllegalArgumentException if fewer than 30 prices or unknown method
     */
    public ValueAtRisk calculateValueAtRisk(double[] closePrices, String method) {
        validateMinimumDataPoints(closePrices, 30);

        double[] returns = calculateLogReturns(closePrices);

        return switch (method.toLowerCase()) {
            case "historical" -> calculateHistoricalVaR(returns);
            case "parametric" -> calculateParametricVaR(returns);
            default -> throw new IllegalArgumentException(
                    "Unknown VaR method: " + method + ". Use 'historical' or 'parametric'.");
        };
    }

    /**
     * Analyzes volatility regime with rolling window decomposition.
     *
     * @param closePrices array of daily closing prices (oldest first)
     * @return volatility analysis with regime classification and rolling trend
     * @throws IllegalArgumentException if fewer than 30 prices are provided
     */
    public VolatilityAnalysis analyzeVolatility(double[] closePrices) {
        validateMinimumDataPoints(closePrices, 30);

        double[] returns = calculateLogReturns(closePrices);

        // Full-period historical volatility
        DescriptiveStatistics fullStats = new DescriptiveStatistics(returns);
        double historicalVol = fullStats.getStandardDeviation() * SQRT_252;

        // Current volatility: last 20 returns (or all if fewer)
        int recentWindow = Math.min(ROLLING_WINDOW, returns.length);
        double[] recentReturns = Arrays.copyOfRange(returns, returns.length - recentWindow, returns.length);
        DescriptiveStatistics recentStats = new DescriptiveStatistics(recentReturns);
        double currentVol = recentStats.getStandardDeviation() * SQRT_252;

        // Rolling 20-day volatility series
        double[] rollingVol = calculateRollingVolatility(returns);

        // Volatility percentile: rank current vol within rolling distribution
        double percentile = calculatePercentile(rollingVol, currentVol);

        // Regime classification based on annualized volatility
        String regime = classifyVolatilityRegime(currentVol);

        return new VolatilityAnalysis(
                currentVol,
                historicalVol,
                percentile,
                regime,
                rollingVol
        );
    }

    /**
     * Calculates the Pearson correlation coefficient between two price series.
     *
     * @param pricesA closing prices for asset A (oldest first)
     * @param pricesB closing prices for asset B (oldest first)
     * @return Pearson correlation coefficient in [-1, 1]
     * @throws IllegalArgumentException if arrays differ in length or have fewer than 30 prices
     */
    public double calculateCorrelation(double[] pricesA, double[] pricesB) {
        if (pricesA.length != pricesB.length) {
            throw new IllegalArgumentException(
                    "Price arrays must have the same length. Got " + pricesA.length + " and " + pricesB.length);
        }
        validateMinimumDataPoints(pricesA, 30);

        double[] returnsA = calculateLogReturns(pricesA);
        double[] returnsB = calculateLogReturns(pricesB);

        return new PearsonsCorrelation().correlation(returnsA, returnsB);
    }

    // ---- Private helpers ----

    /**
     * Computes log returns from a closing price series.
     */
    private double[] calculateLogReturns(double[] closePrices) {
        double[] returns = new double[closePrices.length - 1];
        for (int i = 1; i < closePrices.length; i++) {
            returns[i - 1] = Math.log(closePrices[i] / closePrices[i - 1]);
        }
        return returns;
    }

    /**
     * Calculates the maximum peak-to-trough drawdown from a price series.
     * Returns a negative decimal (e.g., -0.25 for a 25% drawdown).
     */
    private double calculateMaxDrawdown(double[] closePrices) {
        double peak = closePrices[0];
        double maxDrawdown = 0.0;

        for (double price : closePrices) {
            if (price > peak) {
                peak = price;
            }
            double drawdown = (price - peak) / peak;
            if (drawdown < maxDrawdown) {
                maxDrawdown = drawdown;
            }
        }
        return maxDrawdown;
    }

    /**
     * Historical VaR using empirical quantiles of the return distribution.
     */
    private ValueAtRisk calculateHistoricalVaR(double[] returns) {
        double[] sorted = Arrays.copyOf(returns, returns.length);
        Arrays.sort(sorted);

        int index95 = (int) Math.floor(sorted.length * 0.05);
        int index99 = (int) Math.floor(sorted.length * 0.01);

        double var95 = sorted[index95];
        double var99 = sorted[index99];

        // CVaR: average of returns at or below the VaR threshold
        double cvar95 = averageBelow(sorted, index95);
        double cvar99 = averageBelow(sorted, index99);

        return new ValueAtRisk(var95, var99, cvar95, cvar99, "historical");
    }

    /**
     * Parametric VaR assuming normally distributed returns.
     */
    private ValueAtRisk calculateParametricVaR(double[] returns) {
        DescriptiveStatistics stats = new DescriptiveStatistics(returns);
        double mean = stats.getMean();
        double stdDev = stats.getStandardDeviation();

        double var95 = mean - Z_95 * stdDev;
        double var99 = mean - Z_99 * stdDev;

        // For parametric CVaR under normal distribution:
        // CVaR = mean - stdDev * phi(z) / (1 - confidence)
        // Using standard normal PDF: phi(z) = exp(-z^2/2) / sqrt(2*pi)
        double phi95 = Math.exp(-Z_95 * Z_95 / 2.0) / Math.sqrt(2.0 * Math.PI);
        double phi99 = Math.exp(-Z_99 * Z_99 / 2.0) / Math.sqrt(2.0 * Math.PI);

        double cvar95 = mean - stdDev * (phi95 / 0.05);
        double cvar99 = mean - stdDev * (phi99 / 0.01);

        return new ValueAtRisk(var95, var99, cvar95, cvar99, "parametric");
    }

    /**
     * Computes the average of all sorted values at or below the given index.
     */
    private double averageBelow(double[] sorted, int thresholdIndex) {
        if (thresholdIndex <= 0) {
            return sorted[0];
        }
        double sum = 0.0;
        for (int i = 0; i <= thresholdIndex; i++) {
            sum += sorted[i];
        }
        return sum / (thresholdIndex + 1);
    }

    /**
     * Calculates rolling 20-day annualized volatility.
     */
    private double[] calculateRollingVolatility(double[] returns) {
        if (returns.length < ROLLING_WINDOW) {
            // Not enough data for rolling window, return single full-period value
            DescriptiveStatistics stats = new DescriptiveStatistics(returns);
            return new double[]{stats.getStandardDeviation() * SQRT_252};
        }

        int rollingCount = returns.length - ROLLING_WINDOW + 1;
        double[] rollingVol = new double[rollingCount];

        for (int i = 0; i < rollingCount; i++) {
            DescriptiveStatistics windowStats = new DescriptiveStatistics();
            for (int j = i; j < i + ROLLING_WINDOW; j++) {
                windowStats.addValue(returns[j]);
            }
            rollingVol[i] = windowStats.getStandardDeviation() * SQRT_252;
        }
        return rollingVol;
    }

    /**
     * Ranks the current volatility within the rolling volatility distribution (0-100 percentile).
     */
    private double calculatePercentile(double[] rollingVol, double currentVol) {
        if (rollingVol.length == 0) {
            return 50.0;
        }
        long countBelow = Arrays.stream(rollingVol).filter(v -> v <= currentVol).count();
        return (double) countBelow / rollingVol.length * 100.0;
    }

    /**
     * Classifies annualized volatility into a regime bucket.
     */
    private String classifyVolatilityRegime(double annualizedVol) {
        if (annualizedVol < 0.15) return "LOW";
        if (annualizedVol < 0.25) return "NORMAL";
        if (annualizedVol < 0.40) return "HIGH";
        return "EXTREME";
    }

    /**
     * Validates that the price array has enough observations for meaningful statistics.
     */
    private void validateMinimumDataPoints(double[] prices, int minimum) {
        if (prices == null || prices.length < minimum) {
            throw new IllegalArgumentException(
                    "Insufficient data: need at least " + minimum + " price observations, got "
                            + (prices == null ? 0 : prices.length));
        }
    }
}
