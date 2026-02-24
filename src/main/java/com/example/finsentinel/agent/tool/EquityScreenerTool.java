package com.example.finsentinel.agent.tool;

import com.example.finsentinel.dto.research.ScreenerCriteria;
import com.example.finsentinel.dto.research.ScreenerResult;
import com.example.finsentinel.service.research.EquityScreenerService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * AI agent tool for equity discovery and screening, inspired by OpenBB's
 * Discovery Extension.
 *
 * <p>Exposes three capabilities to the LLM:
 * <ul>
 *   <li>{@link #screenStocks} -- multi-criteria stock screening</li>
 *   <li>{@link #getMarketMovers} -- today's top gainers/losers/most-active</li>
 *   <li>{@link #searchStocks} -- ticker/name keyword search</li>
 * </ul>
 *
 * <p>All methods follow the project tool contract: catch all exceptions and
 * return human-readable error strings instead of throwing.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EquityScreenerTool {

    private final EquityScreenerService screenerService;

    @Tool(description = "Screen for stocks matching specific criteria such as exchange, market cap range, " +
            "or name search. Use when the user asks 'find large cap tech stocks', 'show me NASDAQ stocks " +
            "with market cap over $10B', or 'screen for small-cap stocks on NYSE'. " +
            "All parameters are optional — omit any you don't need.")
    public String screenStocks(
            @ToolParam(description = "Sector filter, e.g. 'Technology', 'Healthcare', 'Finance'. Optional.")
            String sector,
            @ToolParam(description = "Exchange filter: 'NYSE', 'NASDAQ', 'AMEX'. Optional.")
            String exchange,
            @ToolParam(description = "Minimum market cap in dollars, e.g. '10000000000' for $10B. Optional.")
            String marketCapMin,
            @ToolParam(description = "Maximum market cap in dollars, e.g. '50000000000' for $50B. Optional.")
            String marketCapMax,
            @ToolParam(description = "Search keyword for company name or ticker, e.g. 'apple', 'semi'. Optional.")
            String search,
            @ToolParam(description = "Max number of results to return, 1-50. Defaults to 20.")
            String limit) {
        try {
            BigDecimal minCap = parseBigDecimal(marketCapMin);
            BigDecimal maxCap = parseBigDecimal(marketCapMax);
            int resultLimit = parseIntOrDefault(limit, 20);

            ScreenerCriteria criteria = new ScreenerCriteria(
                    blankToNull(sector),
                    blankToNull(exchange),
                    minCap,
                    maxCap,
                    blankToNull(search),
                    "market_cap",
                    "desc",
                    resultLimit
            );

            List<ScreenerResult> results = screenerService.screen(criteria);

            if (results.isEmpty()) {
                return "No stocks found matching the specified criteria. Try broadening your filters.";
            }

            return formatScreenerResults("Stock Screener Results", results);

        } catch (Exception e) {
            log.error("Stock screening failed", e);
            return "Error screening stocks: " + e.getMessage();
        }
    }

    @Tool(description = "Get today's top market movers — gainers, losers, or most actively traded stocks. " +
            "Use when the user asks 'what stocks are up today?', 'show me the biggest losers', " +
            "'which stocks have the most volume today?', or 'what's moving in the market?'.")
    public String getMarketMovers(
            @ToolParam(description = "Type of movers: 'gainers' (top price increases), " +
                    "'losers' (top price decreases), or 'most_active' (highest volume). " +
                    "Defaults to 'gainers'.")
            String type) {
        try {
            if (type == null || type.isBlank()) {
                type = "gainers";
            }
            type = type.toLowerCase().trim();

            if (!List.of("gainers", "losers", "most_active").contains(type)) {
                return "Invalid mover type '" + type + "'. Use 'gainers', 'losers', or 'most_active'.";
            }

            List<ScreenerResult> results = screenerService.getMarketMovers(type);

            if (results.isEmpty()) {
                return "No market mover data available at this time. Markets may be closed.";
            }

            String title = switch (type) {
                case "gainers" -> "Today's Top Gainers";
                case "losers" -> "Today's Top Losers";
                case "most_active" -> "Today's Most Active Stocks";
                default -> "Market Movers";
            };

            return formatRankedResults(title, results);

        } catch (Exception e) {
            log.error("Failed to fetch market movers", e);
            return "Error fetching market movers: " + e.getMessage();
        }
    }

    @Tool(description = "Search for stocks by name or ticker keyword. Use when the user says " +
            "'find stocks related to semiconductors', 'search for Amazon', 'look up TSLA', " +
            "or needs to discover tickers for a particular company or industry.")
    public String searchStocks(
            @ToolParam(description = "Search query — company name, ticker, or keyword. " +
                    "Examples: 'tesla', 'AAPL', 'semiconductor', 'artificial intelligence'.")
            String query,
            @ToolParam(description = "Max results to return, 1-50. Defaults to 10.")
            String limit) {
        try {
            if (query == null || query.isBlank()) {
                return "Please provide a search query (company name, ticker, or keyword).";
            }

            int resultLimit = parseIntOrDefault(limit, 10);
            List<ScreenerResult> results = screenerService.searchTickers(query.trim(), resultLimit);

            if (results.isEmpty()) {
                return "No stocks found matching '" + query + "'. Try a different search term.";
            }

            return formatScreenerResults("Search Results for '" + query + "'", results);

        } catch (Exception e) {
            log.error("Stock search failed for '{}'", query, e);
            return "Error searching for stocks: " + e.getMessage();
        }
    }

    // ──────────────────────────────── formatting ─────────────────────────────────

    /**
     * Formats screener results as a numbered table with ticker, name, exchange,
     * and market cap columns.
     */
    private String formatScreenerResults(String title, List<ScreenerResult> results) {
        StringBuilder sb = new StringBuilder();
        sb.append(title).append(" (").append(results.size()).append(" results):\n\n");
        sb.append(String.format("%-4s %-8s %-40s %-8s %15s%n",
                "#", "Ticker", "Name", "Exchange", "Market Cap"));
        sb.append("-".repeat(80)).append("\n");

        for (int i = 0; i < results.size(); i++) {
            ScreenerResult r = results.get(i);
            String name = r.name() != null ? truncate(r.name(), 38) : "N/A";
            String exchange = formatExchange(r.primaryExchange());
            String marketCap = formatMarketCap(r.marketCap());

            sb.append(String.format("%-4d %-8s %-40s %-8s %15s%n",
                    i + 1,
                    r.ticker() != null ? r.ticker() : "N/A",
                    name,
                    exchange,
                    marketCap));
        }

        return sb.toString();
    }

    /**
     * Formats market mover results as a ranked list.
     */
    private String formatRankedResults(String title, List<ScreenerResult> results) {
        StringBuilder sb = new StringBuilder();
        sb.append(title).append(" (").append(results.size()).append(" stocks):\n\n");

        for (int i = 0; i < results.size(); i++) {
            ScreenerResult r = results.get(i);
            String name = r.name() != null ? " (" + truncate(r.name(), 30) + ")" : "";
            sb.append(String.format("%2d. %s%s%n",
                    i + 1,
                    r.ticker() != null ? r.ticker() : "N/A",
                    name));
        }

        return sb.toString();
    }

    // ──────────────────────────────── helpers ────────────────────────────────────

    /**
     * Converts a MIC exchange code to a human-friendly label.
     */
    private String formatExchange(String mic) {
        if (mic == null) return "N/A";
        return switch (mic) {
            case "XNAS" -> "NASDAQ";
            case "XNYS" -> "NYSE";
            case "XASE" -> "AMEX";
            case "ARCX" -> "ARCA";
            default -> mic;
        };
    }

    /**
     * Formats a market cap value into a human-readable string
     * (e.g., "$1.5T", "$250.3B", "$800.0M").
     */
    private String formatMarketCap(BigDecimal marketCap) {
        if (marketCap == null) return "N/A";

        BigDecimal trillion = new BigDecimal("1000000000000");
        BigDecimal billion = new BigDecimal("1000000000");
        BigDecimal million = new BigDecimal("1000000");

        if (marketCap.compareTo(trillion) >= 0) {
            return "$" + marketCap.divide(trillion, 1, RoundingMode.HALF_UP) + "T";
        } else if (marketCap.compareTo(billion) >= 0) {
            return "$" + marketCap.divide(billion, 1, RoundingMode.HALF_UP) + "B";
        } else if (marketCap.compareTo(million) >= 0) {
            return "$" + marketCap.divide(million, 1, RoundingMode.HALF_UP) + "M";
        } else {
            return "$" + marketCap.setScale(0, RoundingMode.HALF_UP);
        }
    }

    private String truncate(String text, int maxLength) {
        if (text.length() <= maxLength) return text;
        return text.substring(0, maxLength - 2) + "..";
    }

    private String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.trim();
    }

    private BigDecimal parseBigDecimal(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return new BigDecimal(value.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private int parseIntOrDefault(String value, int defaultValue) {
        if (value == null || value.isBlank()) return defaultValue;
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }
}
