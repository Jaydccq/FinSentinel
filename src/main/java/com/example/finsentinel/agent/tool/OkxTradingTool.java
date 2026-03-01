package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.okx.OkxApiClient;
import com.example.finsentinel.service.okx.dto.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * AI agent tools for OKX crypto exchange operations.
 *
 * <p>Provides 6 read-heavy tools that expose OKX account, position, funding rate,
 * order history, and leverage management to the LLM. All output is formatted as
 * human-readable text for natural language synthesis.
 *
 * <p>Gated by {@code app.trading.okx.enabled=true} -- the bean is not created
 * unless OKX integration is explicitly enabled.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */
@Component
@Slf4j
@RequiredArgsConstructor
@ConditionalOnProperty(name = "app.trading.okx.enabled", havingValue = "true")
public class OkxTradingTool {

    private final OkxApiClient okxApiClient;

    private static final DateTimeFormatter TS_FMT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss z")
                    .withZone(ZoneId.of("UTC"));

    // ── 1. Account Summary ──────────────────────────────────────────────

    @Tool(description = "Get OKX account summary including total equity, available balance, " +
            "margin used percentage, and unrealized PnL. Use this to understand the user's " +
            "current crypto account health before making trading recommendations.")
    public String getOkxAccount() {
        try {
            OkxResponse<OkxAccountBalance> response = okxApiClient.getBalance();
            if (!response.isSuccess() || response.data().isEmpty()) {
                return "Failed to fetch OKX account balance: " + response.msg();
            }

            OkxAccountBalance balance = response.data().getFirst();
            StringBuilder sb = new StringBuilder();
            sb.append("=== OKX Account Summary ===\n\n");

            String totalEq = formatUsd(balance.totalEq());
            String adjEq = formatUsd(balance.adjEq());
            String ordFroz = formatUsd(balance.ordFroz());
            String imr = formatUsd(balance.imr());

            sb.append(String.format("Total Equity:      %s\n", totalEq));
            sb.append(String.format("Adjusted Equity:   %s\n", adjEq));
            sb.append(String.format("Initial Margin:    %s\n", imr));
            sb.append(String.format("Order Frozen:      %s\n", ordFroz));

            // Margin ratio
            if (balance.mgnRatio() != null && !balance.mgnRatio().isEmpty()) {
                BigDecimal mgnRatio = new BigDecimal(balance.mgnRatio());
                sb.append(String.format("Margin Ratio:      %s%%\n", mgnRatio.setScale(2, RoundingMode.HALF_UP)));
            }

            // Available balance from details
            if (balance.details() != null && !balance.details().isEmpty()) {
                sb.append("\n--- Currency Breakdown ---\n");
                BigDecimal totalUpl = BigDecimal.ZERO;
                for (OkxAccountBalance.BalanceDetail detail : balance.details()) {
                    if (detail.eq() == null || new BigDecimal(detail.eq()).compareTo(BigDecimal.ZERO) == 0) {
                        continue;
                    }
                    sb.append(String.format("  %s: equity=%s, available=%s, frozen=%s",
                            detail.ccy(),
                            formatAmount(detail.eq()),
                            formatAmount(detail.availBal()),
                            formatAmount(detail.frozenBal())));
                    if (detail.upl() != null && !detail.upl().isEmpty()) {
                        BigDecimal upl = new BigDecimal(detail.upl());
                        if (upl.compareTo(BigDecimal.ZERO) != 0) {
                            sb.append(String.format(", unrealizedPnL=%s", formatPnl(detail.upl())));
                            totalUpl = totalUpl.add(upl);
                        }
                    }
                    sb.append("\n");
                }
                if (totalUpl.compareTo(BigDecimal.ZERO) != 0) {
                    sb.append(String.format("\nTotal Unrealized PnL: %s\n", formatPnl(totalUpl.toPlainString())));
                }
            }

            return sb.toString();
        } catch (Exception e) {
            log.error("Failed to get OKX account", e);
            return "Error fetching OKX account: " + e.getMessage();
        }
    }

    // ── 2. Open Positions ───────────────────────────────────────────────

    @Tool(description = "Get all open OKX positions formatted as a table with instrument, side, size, " +
            "entry price, mark price, PnL, leverage, and liquidation price. " +
            "Use this to assess the user's current crypto exposure and risk.")
    public String getOkxPositions() {
        try {
            OkxResponse<OkxPosition> response = okxApiClient.getPositions();
            if (!response.isSuccess()) {
                return "Failed to fetch OKX positions: " + response.msg();
            }

            List<OkxPosition> positions = response.data();
            if (positions.isEmpty()) {
                return "No open OKX positions.";
            }

            StringBuilder sb = new StringBuilder();
            sb.append("=== OKX Open Positions ===\n\n");
            sb.append(String.format("%-18s %-6s %10s %12s %12s %12s %6s %12s %8s\n",
                    "Instrument", "Side", "Size", "Entry Px", "Mark Px", "PnL", "Lever", "Liq Px", "Mode"));
            sb.append("-".repeat(110)).append("\n");

            for (OkxPosition pos : positions) {
                String side = pos.posSide() != null && !pos.posSide().isEmpty()
                        ? pos.posSide()
                        : (pos.pos() != null && pos.pos().startsWith("-") ? "short" : "long");

                sb.append(String.format("%-18s %-6s %10s %12s %12s %12s %6sx %12s %8s\n",
                        pos.instId(),
                        side,
                        formatAmount(pos.pos()),
                        formatPrice(pos.avgPx()),
                        formatPrice(pos.markPx()),
                        formatPnl(pos.upl()),
                        pos.lever() != null ? pos.lever() : "-",
                        pos.liqPx() != null && !pos.liqPx().isEmpty() ? formatPrice(pos.liqPx()) : "N/A",
                        pos.mgnMode() != null ? pos.mgnMode() : "-"));
            }

            sb.append("\n").append(positions.size()).append(" position(s) open.");
            return sb.toString();
        } catch (Exception e) {
            log.error("Failed to get OKX positions", e);
            return "Error fetching OKX positions: " + e.getMessage();
        }
    }

    // ── 3. Funding Rate ─────────────────────────────────────────────────

    @Tool(description = "Get the current and next funding rate for an OKX perpetual swap instrument, " +
            "plus the estimated daily funding cost. Funding rates are critical for evaluating " +
            "the cost of holding perpetual positions. " +
            "Example instrument: BTC-USDT-SWAP, ETH-USDT-SWAP.")
    public String getOkxFundingRate(
            @ToolParam(description = "Perpetual swap instrument ID, e.g. 'BTC-USDT-SWAP'") String instId) {
        try {
            instId = instId.toUpperCase().trim();
            OkxResponse<OkxFundingRate> response = okxApiClient.getFundingRate(instId);
            if (!response.isSuccess() || response.data().isEmpty()) {
                return "Failed to fetch funding rate for " + instId + ": " + response.msg();
            }

            OkxFundingRate rate = response.data().getFirst();
            StringBuilder sb = new StringBuilder();
            sb.append(String.format("=== Funding Rate: %s ===\n\n", rate.instId()));

            BigDecimal currentRate = parseRate(rate.fundingRate());
            BigDecimal nextRate = parseRate(rate.nextFundingRate());

            sb.append(String.format("Current Funding Rate:  %s%%\n", formatPercent(currentRate)));
            sb.append(String.format("Next Funding Rate:     %s%%\n", formatPercent(nextRate)));

            if (rate.fundingTime() != null && !rate.fundingTime().isEmpty()) {
                sb.append(String.format("Current Settlement:    %s\n", formatTimestamp(rate.fundingTime())));
            }
            if (rate.nextFundingTime() != null && !rate.nextFundingTime().isEmpty()) {
                sb.append(String.format("Next Settlement:       %s\n", formatTimestamp(rate.nextFundingTime())));
            }

            // Estimated daily cost (3 funding intervals per day on OKX)
            if (currentRate != null) {
                BigDecimal dailyRate = currentRate.multiply(BigDecimal.valueOf(3));
                BigDecimal annualRate = dailyRate.multiply(BigDecimal.valueOf(365));
                sb.append(String.format("\nEstimated Daily Cost:  %s%% (3 intervals/day)\n", formatPercent(dailyRate)));
                sb.append(String.format("Estimated Annual Cost: %s%%\n", formatPercent(annualRate)));

                if (currentRate.compareTo(BigDecimal.ZERO) > 0) {
                    sb.append("\nNote: Positive rate means LONGS pay SHORTS.");
                } else if (currentRate.compareTo(BigDecimal.ZERO) < 0) {
                    sb.append("\nNote: Negative rate means SHORTS pay LONGS.");
                }
            }

            return sb.toString();
        } catch (Exception e) {
            log.error("Failed to get OKX funding rate for {}", instId, e);
            return "Error fetching funding rate: " + e.getMessage();
        }
    }

    // ── 4. Order History ────────────────────────────────────────────────

    @Tool(description = "Get recent OKX order history for an instrument type. " +
            "Shows filled, cancelled, and partially filled orders with prices and PnL. " +
            "Instrument types: SPOT, SWAP, FUTURES, OPTION.")
    public String getOkxOrderHistory(
            @ToolParam(description = "Instrument type: SPOT, SWAP, FUTURES, or OPTION") String instType) {
        try {
            instType = instType.toUpperCase().trim();
            OkxResponse<OkxOrder> response = okxApiClient.getOrderHistory(instType);
            if (!response.isSuccess()) {
                return "Failed to fetch OKX order history: " + response.msg();
            }

            List<OkxOrder> orders = response.data();
            if (orders.isEmpty()) {
                return "No order history found for instrument type: " + instType;
            }

            StringBuilder sb = new StringBuilder();
            sb.append(String.format("=== OKX Order History (%s) ===\n\n", instType));
            sb.append(String.format("%-18s %-6s %-8s %10s %12s %12s %-12s %10s\n",
                    "Instrument", "Side", "Type", "Size", "Price", "Avg Fill", "State", "PnL"));
            sb.append("-".repeat(100)).append("\n");

            int shown = 0;
            for (OkxOrder order : orders) {
                if (shown >= 20) break;
                shown++;

                sb.append(String.format("%-18s %-6s %-8s %10s %12s %12s %-12s %10s\n",
                        order.instId(),
                        order.side() != null ? order.side() : "-",
                        order.ordType() != null ? order.ordType() : "-",
                        formatAmount(order.sz()),
                        formatPrice(order.px()),
                        formatPrice(order.avgPx()),
                        order.state() != null ? order.state() : "-",
                        formatPnl(order.pnl())));
            }

            sb.append(String.format("\nShowing %d of %d orders.", shown, orders.size()));
            return sb.toString();
        } catch (Exception e) {
            log.error("Failed to get OKX order history for {}", instType, e);
            return "Error fetching order history: " + e.getMessage();
        }
    }

    // ── 5. Analyze Position (Placeholder) ───────────────────────────────

    @Tool(description = "Analyze an OKX position for risk and opportunity assessment. " +
            "Currently a placeholder -- full analysis will use the crypto-analysis prompt template " +
            "with real-time funding rates, technical indicators, and liquidation risk calculations.")
    public String analyzeOkxPosition(
            @ToolParam(description = "Instrument ID to analyze, e.g. 'BTC-USDT-SWAP'") String instId) {
        instId = instId.toUpperCase().trim();
        return String.format(
                "Position analysis for %s is not yet implemented in this tool.\n\n" +
                "To analyze this position, please use the dedicated crypto-analysis prompt template " +
                "which provides comprehensive risk assessment including:\n" +
                "  - Funding rate cost projection\n" +
                "  - Liquidation distance and margin health\n" +
                "  - Technical indicator signals (RSI, MACD, Bollinger)\n" +
                "  - Correlation with BTC and market regime\n" +
                "  - Position sizing recommendations\n\n" +
                "This tool will be enhanced in a future update to provide inline analysis.",
                instId);
    }

    // ── 6. Set Leverage ─────────────────────────────────────────────────

    @Tool(description = "Set leverage for an OKX instrument. WARNING: This is a SENSITIVE operation " +
            "that changes margin requirements and liquidation prices. Higher leverage amplifies " +
            "both gains and losses. Always confirm with the user before changing leverage. " +
            "Margin modes: 'cross' (shared margin) or 'isolated' (per-position margin).")
    public String setOkxLeverage(
            @ToolParam(description = "Instrument ID, e.g. 'BTC-USDT-SWAP'") String instId,
            @ToolParam(description = "Leverage multiplier, e.g. 5 for 5x") int leverage,
            @ToolParam(description = "Margin mode: 'cross' or 'isolated'") String marginMode) {
        try {
            instId = instId.toUpperCase().trim();
            marginMode = marginMode.toLowerCase().trim();

            if (!"cross".equals(marginMode) && !"isolated".equals(marginMode)) {
                return "Error: marginMode must be 'cross' or 'isolated'. Got: " + marginMode;
            }
            if (leverage < 1 || leverage > 125) {
                return "Error: leverage must be between 1 and 125. Got: " + leverage;
            }

            // Warn the user
            StringBuilder sb = new StringBuilder();
            sb.append(String.format("WARNING: Setting leverage to %dx for %s (%s margin).\n",
                    leverage, instId, marginMode));
            sb.append("This will affect liquidation prices and margin requirements.\n\n");

            OkxResponse<?> response = okxApiClient.setLeverage(
                    instId, String.valueOf(leverage), marginMode);

            if (!response.isSuccess()) {
                sb.append("FAILED: ").append(response.msg());
                return sb.toString();
            }

            sb.append(String.format("SUCCESS: Leverage set to %dx for %s (%s margin).\n",
                    leverage, instId, marginMode));
            sb.append("Liquidation prices have been recalculated. Use getOkxPositions to verify.");
            return sb.toString();
        } catch (Exception e) {
            log.error("Failed to set OKX leverage for {}", instId, e);
            return "Error setting leverage: " + e.getMessage();
        }
    }

    // ── Formatting Helpers ──────────────────────────────────────────────

    private String formatUsd(String value) {
        if (value == null || value.isEmpty()) return "$0.00";
        try {
            return "$" + new BigDecimal(value).setScale(2, RoundingMode.HALF_UP).toPlainString();
        } catch (NumberFormatException e) {
            return value;
        }
    }

    private String formatAmount(String value) {
        if (value == null || value.isEmpty()) return "0";
        try {
            BigDecimal bd = new BigDecimal(value);
            return bd.stripTrailingZeros().toPlainString();
        } catch (NumberFormatException e) {
            return value;
        }
    }

    private String formatPrice(String value) {
        if (value == null || value.isEmpty()) return "-";
        try {
            return new BigDecimal(value).stripTrailingZeros().toPlainString();
        } catch (NumberFormatException e) {
            return value;
        }
    }

    private String formatPnl(String value) {
        if (value == null || value.isEmpty()) return "$0.00";
        try {
            BigDecimal pnl = new BigDecimal(value).setScale(2, RoundingMode.HALF_UP);
            String prefix = pnl.compareTo(BigDecimal.ZERO) >= 0 ? "+$" : "-$";
            return prefix + pnl.abs().toPlainString();
        } catch (NumberFormatException e) {
            return value;
        }
    }

    private BigDecimal parseRate(String value) {
        if (value == null || value.isEmpty()) return null;
        try {
            return new BigDecimal(value).multiply(BigDecimal.valueOf(100));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private String formatPercent(BigDecimal value) {
        if (value == null) return "N/A";
        return value.setScale(4, RoundingMode.HALF_UP).toPlainString();
    }

    private String formatTimestamp(String epochMs) {
        if (epochMs == null || epochMs.isEmpty()) return "-";
        try {
            long ms = Long.parseLong(epochMs);
            return TS_FMT.format(Instant.ofEpochMilli(ms));
        } catch (NumberFormatException e) {
            return epochMs;
        }
    }
}
