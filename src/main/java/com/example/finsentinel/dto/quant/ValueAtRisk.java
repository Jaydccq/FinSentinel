package com.example.finsentinel.dto.quant;

/**
 * Value at Risk (VaR) and Conditional VaR estimates for portfolio loss quantification.
 *
 * <p>VaR values are expressed as negative decimals representing the maximum expected
 * daily loss at a given confidence level (e.g., -0.02 means a 2% daily loss).
 * CVaR (Expected Shortfall) captures the average loss beyond the VaR threshold,
 * providing a more conservative tail-risk measure.
 *
 * @param var95  daily VaR at 95% confidence (negative decimal)
 * @param var99  daily VaR at 99% confidence (negative decimal)
 * @param cvar95 conditional VaR at 95% — average loss beyond var95
 * @param cvar99 conditional VaR at 99% — average loss beyond var99
 * @param method calculation method: "historical" (empirical quantile) or "parametric" (normal assumption)
 */
public record ValueAtRisk(
        double var95,
        double var99,
        double cvar95,
        double cvar99,
        String method
) {}
