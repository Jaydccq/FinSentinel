package com.example.finsentinel.dto.quant;

/**
 * Statistical summary of asset return characteristics.
 *
 * <p>Captures both raw and annualized return/risk metrics plus distribution
 * shape (skewness, kurtosis) and drawdown analysis. All return values are
 * expressed as decimals (e.g., 0.05 = 5%).
 *
 * @param meanReturn           average daily log return
 * @param annualizedReturn     mean return scaled by 252 trading days
 * @param standardDeviation    daily return standard deviation
 * @param annualizedVolatility daily std dev scaled by sqrt(252)
 * @param skewness             return distribution asymmetry (negative = left tail risk)
 * @param kurtosis             return distribution tail thickness (excess kurtosis; &gt;0 = fat tails)
 * @param maxDrawdown          maximum peak-to-trough decline as a decimal (e.g., -0.25 = -25%)
 * @param sharpeRatio          risk-adjusted return assuming 5% annual risk-free rate
 * @param dataPoints           number of return observations used
 */
public record ReturnStatistics(
        double meanReturn,
        double annualizedReturn,
        double standardDeviation,
        double annualizedVolatility,
        double skewness,
        double kurtosis,
        double maxDrawdown,
        double sharpeRatio,
        int dataPoints
) {}
