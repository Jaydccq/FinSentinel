package com.example.finsentinel.agent.tool;

import com.example.finsentinel.dto.quant.ReturnStatistics;
import com.example.finsentinel.dto.quant.ValueAtRisk;
import com.example.finsentinel.dto.quant.VolatilityAnalysis;
import com.example.finsentinel.service.quant.QuantitativeAnalysisService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * AI agent tool for quantitative risk analytics, inspired by OpenBB's Quantitative Extension.
 *
 * <p>Provides the LLM with statistical analysis capabilities — return distributions,
 * Value at Risk, volatility regime classification, and cross-asset correlation.
 * Each tool method accepts raw OHLCV bar JSON (from {@code getHistoricalPrices}),
 * delegates computation to {@link QuantitativeAnalysisService}, and returns
 * human-readable risk interpretations.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class QuantAnalysisTool {

    private final QuantitativeAnalysisService quantService;
    private final ObjectMapper objectMapper;

    @Tool(description = "Analyze return statistics for a stock including annualized return, volatility, " +
            "Sharpe ratio, max drawdown, skewness, and kurtosis. Use this to assess overall risk/return " +
            "profile. Negative skewness means left-tail risk (crash risk). High kurtosis means fat tails " +
            "(extreme moves more likely). Sharpe ratio < 1 = poor risk-adjusted return, > 2 = excellent. " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    public String analyzeReturns(
            @ToolParam(description = "JSON array of price bars [{o,h,l,c,v,t}, ...] from getHistoricalPrices") String barsJson) {
        try {
            double[] closePrices = extractClosePrices(barsJson);
            ReturnStatistics stats = quantService.calculateReturnStatistics(closePrices);

            String riskAssessment = assessReturnRisk(stats);

            return String.format("""
                    Return Statistics Analysis (%d trading days):

                    RETURNS:
                    - Mean Daily Return: %.4f%% (%.2f%% annualized)
                    - Max Drawdown: %.2f%%

                    RISK:
                    - Daily Volatility: %.4f%% (%.2f%% annualized)
                    - Sharpe Ratio: %.2f

                    DISTRIBUTION:
                    - Skewness: %.3f %s
                    - Excess Kurtosis: %.3f %s

                    RISK ASSESSMENT: %s""",
                    stats.dataPoints(),
                    stats.meanReturn() * 100, stats.annualizedReturn() * 100,
                    stats.maxDrawdown() * 100,
                    stats.standardDeviation() * 100, stats.annualizedVolatility() * 100,
                    stats.sharpeRatio(),
                    stats.skewness(),
                    stats.skewness() < -0.5 ? "(negative skew — elevated crash risk)" :
                            stats.skewness() > 0.5 ? "(positive skew — upside tail)" : "(near symmetric)",
                    stats.kurtosis(),
                    stats.kurtosis() > 1.0 ? "(fat tails — extreme moves more likely than normal)" :
                            stats.kurtosis() < -0.5 ? "(thin tails — fewer extremes)" : "(near normal tails)",
                    riskAssessment);

        } catch (Exception e) {
            log.error("Return statistics analysis failed", e);
            return "Error analyzing returns: " + e.getMessage();
        }
    }

    @Tool(description = "Calculate Value at Risk (VaR) and Conditional VaR (Expected Shortfall) for a stock. " +
            "VaR answers: 'What is the maximum expected daily loss at a given confidence level?' " +
            "For example, 95% VaR of -2% on a $100K position means you should not lose more than $2,000 " +
            "in a single day 95% of the time. CVaR measures average loss in the worst cases beyond VaR. " +
            "Use 'historical' method for non-normal distributions or 'parametric' for normal assumption. " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    public String calculateVaR(
            @ToolParam(description = "JSON array of price bars [{o,h,l,c,v,t}, ...] from getHistoricalPrices") String barsJson,
            @ToolParam(description = "VaR calculation method: 'historical' (empirical quantile, better for " +
                    "non-normal distributions) or 'parametric' (assumes normal distribution)") String method) {
        try {
            double[] closePrices = extractClosePrices(barsJson);
            ValueAtRisk var = quantService.calculateValueAtRisk(closePrices, method);

            String riskLevel;
            if (var.var95() < -0.03) riskLevel = "HIGH RISK — daily losses could exceed 3%";
            else if (var.var95() < -0.02) riskLevel = "MODERATE RISK — daily losses up to 2-3%";
            else riskLevel = "LOW RISK — daily losses typically under 2%";

            return String.format("""
                    Value at Risk Analysis (method: %s):

                    DAILY VaR:
                    - 95%% VaR: %.4f%% (on a $100K position, max daily loss ~$%.0f in 19/20 trading days)
                    - 99%% VaR: %.4f%% (on a $100K position, max daily loss ~$%.0f in 99/100 trading days)

                    CONDITIONAL VaR (Expected Shortfall):
                    - 95%% CVaR: %.4f%% (average loss on the worst 5%% of days)
                    - 99%% CVaR: %.4f%% (average loss on the worst 1%% of days)

                    INTERPRETATION:
                    - %s
                    - CVaR is more conservative than VaR and captures tail risk better
                    - VaR breaches should be expected ~1 day per month (95%%) or ~2-3 days per year (99%%)""",
                    var.method(),
                    var.var95() * 100, Math.abs(var.var95()) * 100000,
                    var.var99() * 100, Math.abs(var.var99()) * 100000,
                    var.cvar95() * 100,
                    var.cvar99() * 100,
                    riskLevel);

        } catch (Exception e) {
            log.error("VaR calculation failed", e);
            return "Error calculating VaR: " + e.getMessage();
        }
    }

    @Tool(description = "Analyze current volatility regime for a stock — is volatility low, normal, high, or extreme? " +
            "Compares recent 20-day volatility against historical levels and identifies the regime. " +
            "High volatility = wider stop-losses needed, position size should decrease. " +
            "Low volatility often precedes breakouts. Includes rolling volatility trend. " +
            "Input is JSON array of OHLCV bars from getHistoricalPrices.")
    public String analyzeVolatility(
            @ToolParam(description = "JSON array of price bars [{o,h,l,c,v,t}, ...] from getHistoricalPrices") String barsJson) {
        try {
            double[] closePrices = extractClosePrices(barsJson);
            VolatilityAnalysis vol = quantService.analyzeVolatility(closePrices);

            String trendDescription = describeVolatilityTrend(vol.rollingVolatility());

            return String.format("""
                    Volatility Analysis:

                    CURRENT STATE:
                    - Current Volatility (20-day): %.2f%% annualized
                    - Historical Volatility (full period): %.2f%% annualized
                    - Volatility Percentile: %.1f%% (current vol is higher than %.0f%% of historical readings)
                    - Regime: %s

                    REGIME THRESHOLDS:
                    - LOW: < 15%% | NORMAL: 15-25%% | HIGH: 25-40%% | EXTREME: > 40%%

                    TREND: %s

                    IMPLICATIONS:
                    %s""",
                    vol.currentVolatility() * 100,
                    vol.historicalVolatility() * 100,
                    vol.volatilityPercentile(), vol.volatilityPercentile(),
                    vol.regime(),
                    trendDescription,
                    regimeImplications(vol.regime()));

        } catch (Exception e) {
            log.error("Volatility analysis failed", e);
            return "Error analyzing volatility: " + e.getMessage();
        }
    }

    @Tool(description = "Calculate the Pearson correlation between two stocks' returns. " +
            "Correlation > 0.7 = highly correlated (move together, less diversification benefit). " +
            "Correlation 0.3-0.7 = moderately correlated. Correlation < 0.3 = low correlation " +
            "(good for diversification). Negative correlation = inverse relationship (natural hedge). " +
            "Both inputs must cover the same time period with the same number of bars.")
    public String calculateCorrelation(
            @ToolParam(description = "JSON array of price bars for first stock [{o,h,l,c,v,t}, ...]") String barsJsonA,
            @ToolParam(description = "JSON array of price bars for second stock [{o,h,l,c,v,t}, ...]") String barsJsonB) {
        try {
            double[] pricesA = extractClosePrices(barsJsonA);
            double[] pricesB = extractClosePrices(barsJsonB);

            double correlation = quantService.calculateCorrelation(pricesA, pricesB);

            String interpretation;
            if (correlation > 0.7) interpretation = "HIGHLY CORRELATED — these assets move together; limited diversification benefit";
            else if (correlation > 0.3) interpretation = "MODERATELY CORRELATED — some shared movement but partial diversification";
            else if (correlation > -0.3) interpretation = "LOW CORRELATION — good diversification potential";
            else if (correlation > -0.7) interpretation = "NEGATIVELY CORRELATED — natural hedging relationship";
            else interpretation = "STRONGLY INVERSELY CORRELATED — strong natural hedge";

            String portfolioAdvice;
            if (correlation > 0.7) portfolioAdvice = "Consider reducing overlap — holding both adds concentration risk, not diversification.";
            else if (correlation < -0.3) portfolioAdvice = "Excellent diversifier — this pair provides natural downside protection.";
            else portfolioAdvice = "Moderate diversification benefit — adding both can reduce portfolio volatility.";

            return String.format("""
                    Correlation Analysis:

                    - Pearson Correlation: %.4f
                    - Interpretation: %s

                    PORTFOLIO IMPACT:
                    - %s

                    SCALE REFERENCE:
                    -1.0 = perfect inverse | 0.0 = no relationship | +1.0 = perfect positive""",
                    correlation,
                    interpretation,
                    portfolioAdvice);

        } catch (Exception e) {
            log.error("Correlation calculation failed", e);
            return "Error calculating correlation: " + e.getMessage();
        }
    }

    // ---- Private helpers ----

    /**
     * Extracts an array of closing prices from OHLCV bar JSON.
     * Expects format: [{o, h, l, c, v, t}, ...]
     */
    private double[] extractClosePrices(String barsJson) throws Exception {
        JsonNode bars = objectMapper.readTree(barsJson);
        if (!bars.isArray() || bars.isEmpty()) {
            throw new IllegalArgumentException("Expected a non-empty JSON array of price bars");
        }

        double[] closePrices = new double[bars.size()];
        for (int i = 0; i < bars.size(); i++) {
            JsonNode bar = bars.get(i);
            if (bar.get("c") == null) {
                throw new IllegalArgumentException("Bar at index " + i + " missing 'c' (close price) field");
            }
            closePrices[i] = bar.get("c").asDouble();
        }
        return closePrices;
    }

    /**
     * Produces a risk assessment summary based on return statistics.
     */
    private String assessReturnRisk(ReturnStatistics stats) {
        StringBuilder assessment = new StringBuilder();

        if (stats.sharpeRatio() > 2.0) assessment.append("Excellent risk-adjusted return. ");
        else if (stats.sharpeRatio() > 1.0) assessment.append("Good risk-adjusted return. ");
        else if (stats.sharpeRatio() > 0) assessment.append("Positive but poor risk-adjusted return. ");
        else assessment.append("Negative risk-adjusted return — risk not compensated. ");

        if (stats.maxDrawdown() < -0.30) assessment.append("Severe historical drawdown (>30%). ");
        else if (stats.maxDrawdown() < -0.15) assessment.append("Notable drawdown history (15-30%). ");

        if (stats.skewness() < -0.5) assessment.append("Left-skewed returns — elevated crash risk. ");
        if (stats.kurtosis() > 3.0) assessment.append("Very fat tails — extreme moves significantly more likely than normal distribution assumes.");

        return assessment.toString().trim();
    }

    /**
     * Describes the volatility trend from rolling volatility data.
     */
    private String describeVolatilityTrend(double[] rollingVol) {
        if (rollingVol.length < 5) {
            return "Insufficient rolling data to determine trend";
        }

        // Compare the last 5 values to the first 5
        double recentAvg = 0;
        double earlyAvg = 0;
        int window = Math.min(5, rollingVol.length / 2);

        for (int i = 0; i < window; i++) {
            earlyAvg += rollingVol[i];
            recentAvg += rollingVol[rollingVol.length - 1 - i];
        }
        earlyAvg /= window;
        recentAvg /= window;

        double change = (recentAvg - earlyAvg) / earlyAvg * 100;

        if (change > 20) return String.format("RISING — volatility increased %.0f%% over the period (risk expanding)", change);
        if (change < -20) return String.format("FALLING — volatility decreased %.0f%% over the period (risk contracting)", Math.abs(change));
        return "STABLE — volatility relatively unchanged over the period";
    }

    /**
     * Returns regime-specific investment implications.
     */
    private String regimeImplications(String regime) {
        return switch (regime) {
            case "LOW" -> """
                    - Low volatility often precedes a breakout or trend change
                    - Options are cheaper (lower implied vol) — consider protective puts
                    - Position sizing can be larger with tighter stop-losses""";
            case "NORMAL" -> """
                    - Typical market conditions — standard risk management applies
                    - Maintain normal position sizes and stop-loss distances""";
            case "HIGH" -> """
                    - Reduce position sizes to maintain constant dollar-risk
                    - Widen stop-losses to avoid whipsaw exits
                    - Consider hedging with options or inverse ETFs""";
            case "EXTREME" -> """
                    - Crisis-level volatility — capital preservation is priority
                    - Significantly reduce exposure or hedge aggressively
                    - Avoid leveraged positions; consider raising cash""";
            default -> "- Monitor conditions and adjust risk parameters accordingly";
        };
    }
}
