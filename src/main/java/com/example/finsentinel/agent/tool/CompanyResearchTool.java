package com.example.finsentinel.agent.tool;

import com.example.finsentinel.dto.research.AnalystConsensus;
import com.example.finsentinel.dto.research.CompanyProfile;
import com.example.finsentinel.dto.research.FinancialMetrics;
import com.example.finsentinel.service.research.CompanyResearchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.List;

/**
 * AI agent tools for company fundamental research and analysis.
 *
 * <p>Provides the LLM with access to company profiles, financial statements,
 * and computed analyst consensus. Inspired by the OpenBB Fundamental Extension.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class CompanyResearchTool {

    private final CompanyResearchService researchService;

    @Tool(description = "Get company profile and overview for a stock ticker. " +
            "Returns company name, sector, industry, market cap, description, employee count, " +
            "IPO date, exchange, and homepage URL. " +
            "Use this when the user asks 'tell me about AAPL', 'what does MSFT do?', " +
            "'company overview for TSLA', or any request for basic company information.")
    public String getCompanyProfile(
            @ToolParam(description = "Stock ticker symbol, e.g. AAPL, MSFT, TSLA") String ticker) {
        try {
            CompanyProfile profile = researchService.getCompanyProfile(ticker);
            if (profile == null) {
                return "No company profile data found for " + ticker.toUpperCase().trim()
                        + ". The ticker may be invalid or data is temporarily unavailable.";
            }

            return String.format("""
                    Company Profile: %s (%s)
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    - Name: %s
                    - Exchange: %s
                    - Sector: %s
                    - Industry: %s
                    - Market Cap: %s
                    - Employees: %s
                    - IPO Date: %s
                    - Website: %s

                    Description:
                    %s""",
                    profile.name(), profile.ticker(),
                    profile.name(),
                    profile.exchange(),
                    profile.sector(),
                    profile.industry(),
                    formatMarketCap(profile.marketCap()),
                    profile.employeeCount() > 0
                            ? String.format("%,d", profile.employeeCount()) : "N/A",
                    profile.listDate(),
                    profile.homepageUrl().isEmpty() ? "N/A" : profile.homepageUrl(),
                    truncate(profile.description(), 500));

        } catch (Exception e) {
            log.error("Failed to get company profile for {}", ticker, e);
            return "Error fetching company profile for " + ticker + ": " + e.getMessage();
        }
    }

    @Tool(description = "Get financial statements and key metrics for a stock ticker. " +
            "Returns revenue, net income, EPS, margins (gross/operating/net), " +
            "balance sheet health (assets, liabilities, equity, current ratio, debt-to-equity), " +
            "valuation ratios (PE, PB), revenue growth, and cash flow data. " +
            "Data comes from SEC filings via Polygon.io. " +
            "Use this when the user asks about financial performance, earnings, profitability, " +
            "balance sheet strength, or financial trends for a company.")
    public String getFinancialStatements(
            @ToolParam(description = "Stock ticker symbol, e.g. AAPL, MSFT") String ticker,
            @ToolParam(description = "Number of fiscal periods to retrieve (1-10, default 4)") int periods) {
        try {
            periods = Math.min(Math.max(periods, 1), 10);
            List<FinancialMetrics> metricsList = researchService.getFinancialMetrics(ticker, periods);
            if (metricsList.isEmpty()) {
                return "No financial data found for " + ticker.toUpperCase().trim()
                        + ". The ticker may not have SEC filings available.";
            }

            StringBuilder sb = new StringBuilder();
            sb.append("Financial Statements for ").append(ticker.toUpperCase().trim())
                    .append(" (last ").append(metricsList.size()).append(" periods)\n");
            sb.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n");

            for (int i = 0; i < metricsList.size(); i++) {
                FinancialMetrics m = metricsList.get(i);
                sb.append("Period: ").append(m.fiscalPeriod())
                        .append(" (").append(m.period()).append(")\n");
                sb.append("────────────────────────────────\n");

                // Income Statement
                sb.append("  Income Statement:\n");
                sb.append("    Revenue:          ").append(formatCurrency(m.revenue())).append("\n");
                sb.append("    Net Income:       ").append(formatCurrency(m.netIncome())).append("\n");
                sb.append("    EPS:              ").append(formatValue(m.eps(), "$")).append("\n");
                sb.append("    Gross Margin:     ").append(formatPercent(m.grossMargin())).append("\n");
                sb.append("    Operating Margin: ").append(formatPercent(m.operatingMargin())).append("\n");
                sb.append("    Net Margin:       ").append(formatPercent(m.netMargin())).append("\n");

                // Balance Sheet
                sb.append("  Balance Sheet:\n");
                sb.append("    Total Assets:       ").append(formatCurrency(m.totalAssets())).append("\n");
                sb.append("    Total Liabilities:  ").append(formatCurrency(m.totalLiabilities())).append("\n");
                sb.append("    Total Equity:       ").append(formatCurrency(m.totalEquity())).append("\n");
                sb.append("    Current Ratio:      ").append(formatRatio(m.currentRatio())).append("\n");
                sb.append("    Debt-to-Equity:     ").append(formatRatio(m.debtToEquity())).append("\n");

                // Valuation
                sb.append("  Valuation:\n");
                sb.append("    P/E Ratio:        ").append(formatRatio(m.peRatio())).append("\n");
                sb.append("    P/B Ratio:        ").append(formatRatio(m.pbRatio())).append("\n");
                sb.append("    Revenue Growth:   ").append(formatPercent(m.revenueGrowth())).append("\n");

                // Cash Flow
                sb.append("  Cash Flow:\n");
                sb.append("    Operating CF:     ").append(formatCurrency(m.operatingCashFlow())).append("\n");
                sb.append("    Free Cash Flow:   ").append(formatCurrency(m.freeCashFlow())).append("\n");
                sb.append("    CapEx:            ").append(formatCurrency(m.capitalExpenditure())).append("\n");

                if (i < metricsList.size() - 1) {
                    sb.append("\n");
                }
            }

            // Trend analysis if multiple periods available
            if (metricsList.size() >= 2) {
                sb.append("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
                sb.append("Trend Analysis:\n");
                FinancialMetrics latest = metricsList.getFirst();
                FinancialMetrics oldest = metricsList.getLast();

                sb.append("  Revenue Trend: ").append(trendArrow(latest.revenue(), oldest.revenue())).append("\n");
                sb.append("  Net Income Trend: ").append(trendArrow(latest.netIncome(), oldest.netIncome())).append("\n");
                sb.append("  Margin Trend: ").append(trendArrow(latest.netMargin(), oldest.netMargin())).append("\n");
            }

            return sb.toString();

        } catch (Exception e) {
            log.error("Failed to get financial statements for {}", ticker, e);
            return "Error fetching financial data for " + ticker + ": " + e.getMessage();
        }
    }

    @Tool(description = "Get analyst rating and price target estimates for a stock ticker. " +
            "Returns recommendation (STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL), target price range " +
            "(high/low/median), current price, and upside potential percentage. " +
            "IMPORTANT: These are computed estimates based on financial metrics (PE ratio, revenue growth, " +
            "net margin), NOT real analyst consensus data. Always communicate this to the user. " +
            "Use this when the user asks about analyst opinions, price targets, or buy/sell recommendations.")
    public String getAnalystRating(
            @ToolParam(description = "Stock ticker symbol, e.g. AAPL, MSFT") String ticker) {
        try {
            AnalystConsensus consensus = researchService.getAnalystConsensus(ticker);
            if (consensus == null) {
                return "Unable to compute analyst rating for " + ticker.toUpperCase().trim()
                        + ". Insufficient financial data or current price unavailable.";
            }

            String recEmoji;
            switch (consensus.recommendation()) {
                case "STRONG_BUY" -> recEmoji = "[STRONG BUY]";
                case "BUY" -> recEmoji = "[BUY]";
                case "HOLD" -> recEmoji = "[HOLD]";
                case "SELL" -> recEmoji = "[SELL]";
                case "STRONG_SELL" -> recEmoji = "[STRONG SELL]";
                default -> recEmoji = "[" + consensus.recommendation() + "]";
            }

            return String.format("""
                    Analyst Rating for %s
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    Recommendation: %s %s

                    Price Targets:
                    - Current Price:  $%s
                    - Target Low:     $%s
                    - Target Median:  $%s
                    - Target High:    $%s
                    - Upside Potential: %s%%

                    DISCLAIMER: %s""",
                    consensus.ticker(),
                    recEmoji, consensus.recommendation(),
                    consensus.currentPrice().toPlainString(),
                    consensus.targetPriceLow().toPlainString(),
                    consensus.targetPriceMedian().toPlainString(),
                    consensus.targetPriceHigh().toPlainString(),
                    consensus.upsidePotential().toPlainString(),
                    consensus.computationNote());

        } catch (Exception e) {
            log.error("Failed to get analyst rating for {}", ticker, e);
            return "Error computing analyst rating for " + ticker + ": " + e.getMessage();
        }
    }

    // ──────────────────────────── Formatting Helpers ─────────────────────────

    private String formatMarketCap(BigDecimal marketCap) {
        if (marketCap == null || marketCap.compareTo(BigDecimal.ZERO) == 0) {
            return "N/A";
        }
        double val = marketCap.doubleValue();
        if (val >= 1_000_000_000_000.0) {
            return String.format("$%.2fT", val / 1_000_000_000_000.0);
        } else if (val >= 1_000_000_000.0) {
            return String.format("$%.2fB", val / 1_000_000_000.0);
        } else if (val >= 1_000_000.0) {
            return String.format("$%.2fM", val / 1_000_000.0);
        }
        return String.format("$%,.2f", val);
    }

    private String formatCurrency(BigDecimal value) {
        if (value == null) return "N/A";
        double val = value.doubleValue();
        if (Math.abs(val) >= 1_000_000_000.0) {
            return String.format("$%.2fB", val / 1_000_000_000.0);
        } else if (Math.abs(val) >= 1_000_000.0) {
            return String.format("$%.2fM", val / 1_000_000.0);
        }
        return String.format("$%,.2f", val);
    }

    private String formatPercent(BigDecimal value) {
        if (value == null) return "N/A";
        return value.toPlainString() + "%";
    }

    private String formatRatio(BigDecimal value) {
        if (value == null) return "N/A";
        return value.toPlainString();
    }

    private String formatValue(BigDecimal value, String prefix) {
        if (value == null) return "N/A";
        return prefix + value.toPlainString();
    }

    private String trendArrow(BigDecimal latest, BigDecimal oldest) {
        if (latest == null || oldest == null) return "N/A";
        int cmp = latest.compareTo(oldest);
        if (cmp > 0) return "IMPROVING (latest > oldest)";
        if (cmp < 0) return "DECLINING (latest < oldest)";
        return "STABLE (unchanged)";
    }

    private String truncate(String text, int maxLength) {
        if (text == null) return "N/A";
        if (text.length() <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    }
}
