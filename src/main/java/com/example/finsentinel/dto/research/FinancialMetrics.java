package com.example.finsentinel.dto.research;

import java.math.BigDecimal;

/**
 * Key financial metrics derived from SEC filing data via the Polygon.io
 * financials API.
 *
 * <p>Combines raw line items from income statement, balance sheet, and cash flow
 * statement with computed ratios (margins, leverage, valuation). All monetary
 * values are in USD.
 *
 * @param ticker             stock ticker symbol
 * @param period             "annual" or "quarterly"
 * @param fiscalPeriod       human-readable period label (e.g. "FY2024", "Q3 2024")
 * @param revenue            total revenue
 * @param netIncome          net income
 * @param eps                earnings per share (basic)
 * @param grossMargin        gross profit / revenue
 * @param operatingMargin    operating income / revenue
 * @param netMargin          net income / revenue
 * @param totalAssets        total assets
 * @param totalLiabilities   total liabilities
 * @param totalEquity        total stockholders' equity
 * @param currentRatio       current assets / current liabilities
 * @param debtToEquity       total debt / total equity
 * @param peRatio            price / EPS
 * @param pbRatio            price / book value per share
 * @param revenueGrowth      year-over-year revenue growth percentage
 * @param operatingCashFlow  cash from operating activities
 * @param freeCashFlow       operating cash flow minus capital expenditures
 * @param capitalExpenditure capital expenditures (typically negative)
 */
public record FinancialMetrics(
        String ticker,
        String period,
        String fiscalPeriod,
        // Income Statement
        BigDecimal revenue,
        BigDecimal netIncome,
        BigDecimal eps,
        BigDecimal grossMargin,
        BigDecimal operatingMargin,
        BigDecimal netMargin,
        // Balance Sheet
        BigDecimal totalAssets,
        BigDecimal totalLiabilities,
        BigDecimal totalEquity,
        BigDecimal currentRatio,
        BigDecimal debtToEquity,
        // Valuation (computed)
        BigDecimal peRatio,
        BigDecimal pbRatio,
        BigDecimal revenueGrowth,
        // Cash Flow
        BigDecimal operatingCashFlow,
        BigDecimal freeCashFlow,
        BigDecimal capitalExpenditure
) {}
