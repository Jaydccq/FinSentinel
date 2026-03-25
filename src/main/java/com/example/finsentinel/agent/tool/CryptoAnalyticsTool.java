package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.okx.OkxApiClient;
import com.example.finsentinel.service.okx.dto.*;
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
 * AI agent tools for OKX-specific crypto analytics (read-only + leverage config).
 *
 * <p>Extracted from {@link OkxTradingTool} as part of the Unified Trading Account
 * (UTA) refactor. Contains funding-rate analysis, composite position analysis,
 * and leverage management -- operations that are analytics/config rather than
 * order-placement.
 *
 * <p>Gated by {@code app.trading.okx.enabled=true} -- the bean is not created
 * unless OKX integration is explicitly enabled.
 */
@Component
@Slf4j
@ConditionalOnProperty(name = "app.trading.okx.enabled", havingValue = "true")
public class CryptoAnalyticsTool {

    private final OkxApiClient okxApiClient;

    private static final DateTimeFormatter TS_FMT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss z")
                    .withZone(ZoneId.of("UTC"));

    public CryptoAnalyticsTool(OkxApiClient okxApiClient) {
        this.okxApiClient = okxApiClient;
    }

    // -- 1. Funding Rate -------------------------------------------------------

    @Tool(description = "Get the current and next funding rate for a crypto perpetual contract. " +
            "Shows annualized cost/income of holding the position. " +
            "Use this to assess carry cost before opening or keeping a perpetual position. " +
            "Example instrument: BTC-USDT-SWAP, ETH-USDT-SWAP.")
    public String getFundingRate(
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
            log.error("Failed to get funding rate for {}", instId, e);
            return "Error fetching funding rate: " + e.getMessage();
        }
    }

    // -- 2. Analyze Position ---------------------------------------------------

    @Tool(description = "Comprehensive analysis of a crypto perpetual position: " +
            "combines position data, funding rate, and live ticker into a single view. " +
            "Calculates liquidation distance percentage and warns if < 5%. " +
            "Use this to quickly assess a position before making trading recommendations.")
    public String analyzePosition(
            @ToolParam(description = "Instrument ID to analyze, e.g. 'BTC-USDT-SWAP'") String instId) {
        final String id = instId.toUpperCase().trim();
        StringBuilder sb = new StringBuilder();
        sb.append(String.format("=== Position Analysis: %s ===\n\n", id));

        // 1. Position data
        try {
            OkxResponse<OkxPosition> posResponse = okxApiClient.getPositions();
            if (posResponse.isSuccess()) {
                List<OkxPosition> matching = posResponse.data().stream()
                        .filter(p -> id.equals(p.instId()))
                        .toList();

                if (matching.isEmpty()) {
                    sb.append("No open position found for ").append(id).append(".\n");
                } else {
                    if (matching.size() > 1) {
                        sb.append(String.format("Found %d position legs (hedge mode):\n\n", matching.size()));
                    }
                    for (int legIdx = 0; legIdx < matching.size(); legIdx++) {
                        OkxPosition position = matching.get(legIdx);
                        String side = position.posSide() != null && !position.posSide().isEmpty()
                                ? position.posSide()
                                : (position.pos() != null && position.pos().startsWith("-") ? "short" : "long");

                        if (matching.size() > 1) {
                            sb.append(String.format("--- Position Leg %d (%s) ---\n", legIdx + 1, side));
                        } else {
                            sb.append("--- Position ---\n");
                        }
                        sb.append(String.format("Side:             %s\n", side));
                        sb.append(String.format("Size:             %s\n", formatAmount(position.pos())));
                        sb.append(String.format("Entry Price:      %s\n", formatPrice(position.avgPx())));
                        sb.append(String.format("Mark Price:       %s\n", formatPrice(position.markPx())));
                        sb.append(String.format("Unrealized PnL:   %s\n", formatPnl(position.upl())));
                        sb.append(String.format("Leverage:         %sx\n", position.lever() != null ? position.lever() : "?"));
                        sb.append(String.format("Margin Mode:      %s\n", position.mgnMode() != null ? position.mgnMode() : "?"));

                        String liqPx = position.liqPx() != null && !position.liqPx().isEmpty()
                                ? position.liqPx() : null;
                        sb.append(String.format("Liquidation Px:   %s\n", liqPx != null ? formatPrice(liqPx) : "N/A"));

                        // Liquidation distance
                        if (liqPx != null && position.markPx() != null) {
                            try {
                                BigDecimal mark = new BigDecimal(position.markPx());
                                BigDecimal liq = new BigDecimal(liqPx);
                                if (mark.compareTo(BigDecimal.ZERO) > 0) {
                                    BigDecimal distPct = mark.subtract(liq).abs()
                                            .divide(mark, 6, RoundingMode.HALF_UP)
                                            .multiply(BigDecimal.valueOf(100));
                                    sb.append(String.format("Liq Distance:     %s%%\n", distPct.setScale(2, RoundingMode.HALF_UP)));
                                    if (distPct.compareTo(BigDecimal.valueOf(5)) < 0) {
                                        sb.append("WARNING: Liquidation distance < 5%! Consider reducing leverage or position size.\n");
                                    }
                                }
                            } catch (NumberFormatException ignored) {}
                        }
                        if (legIdx < matching.size() - 1) sb.append("\n");
                    }
                }
            }
        } catch (Exception e) {
            sb.append("Could not fetch position data: ").append(e.getMessage()).append("\n");
        }

        // 2. Funding rate (only for perpetual swaps)
        if (id.contains("-SWAP")) {
            sb.append("\n--- Funding Rate ---\n");
            try {
                OkxResponse<OkxFundingRate> frResponse = okxApiClient.getFundingRate(id);
                if (frResponse.isSuccess() && !frResponse.data().isEmpty()) {
                    OkxFundingRate rate = frResponse.data().getFirst();
                    BigDecimal currentRate = parseRate(rate.fundingRate());
                    BigDecimal nextRate = parseRate(rate.nextFundingRate());
                    sb.append(String.format("Current Rate:     %s%%\n", formatPercent(currentRate)));
                    sb.append(String.format("Next Rate:        %s%%\n", formatPercent(nextRate)));
                    if (currentRate != null) {
                        BigDecimal dailyCost = currentRate.multiply(BigDecimal.valueOf(3));
                        sb.append(String.format("Est. Daily Cost:  %s%%\n", formatPercent(dailyCost)));
                        sb.append(currentRate.compareTo(BigDecimal.ZERO) > 0
                                ? "Direction: Longs pay shorts.\n"
                                : "Direction: Shorts pay longs.\n");
                    }
                } else {
                    sb.append("Funding rate unavailable.\n");
                }
            } catch (Exception e) {
                sb.append("Could not fetch funding rate: ").append(e.getMessage()).append("\n");
            }
        }

        // 3. Live ticker
        sb.append("\n--- Live Ticker ---\n");
        try {
            OkxResponse<OkxTicker> tickerResponse = okxApiClient.getTicker(id);
            if (tickerResponse.isSuccess() && !tickerResponse.data().isEmpty()) {
                OkxTicker ticker = tickerResponse.data().getFirst();
                sb.append(String.format("Last Price:       %s\n", formatPrice(ticker.last())));
                sb.append(String.format("Bid / Ask:        %s / %s\n", formatPrice(ticker.bidPx()), formatPrice(ticker.askPx())));
                sb.append(String.format("24h Volume:       %s\n", formatAmount(ticker.vol24h())));

                if (ticker.open24h() != null && ticker.last() != null) {
                    try {
                        BigDecimal open = new BigDecimal(ticker.open24h());
                        BigDecimal last = new BigDecimal(ticker.last());
                        if (open.compareTo(BigDecimal.ZERO) > 0) {
                            BigDecimal changePct = last.subtract(open)
                                    .divide(open, 6, RoundingMode.HALF_UP)
                                    .multiply(BigDecimal.valueOf(100));
                            sb.append(String.format("24h Change:       %s%%\n",
                                    changePct.setScale(2, RoundingMode.HALF_UP)));
                        }
                    } catch (NumberFormatException ignored) {}
                }
            } else {
                sb.append("Ticker unavailable.\n");
            }
        } catch (Exception e) {
            sb.append("Could not fetch ticker: ").append(e.getMessage()).append("\n");
        }

        return sb.toString();
    }

    // -- 3. Set Leverage -------------------------------------------------------

    @Tool(description = "Set leverage for a crypto instrument. " +
            "Valid range: 1-125. Margin modes: 'cross' (shared margin) or 'isolated' (per-position). " +
            "CRITICAL: This is a LIVE money mutation that changes liquidation prices and margin requirements. " +
            "You MUST call getConfirm BEFORE calling this tool. Do NOT set leverage without explicit user approval.")
    public String setLeverage(
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
            sb.append("Liquidation prices have been recalculated. Use analyzePosition to verify.");
            return sb.toString();
        } catch (Exception e) {
            log.error("Failed to set leverage for {}", instId, e);
            return "Error setting leverage: " + e.getMessage();
        }
    }

    // -- Formatting Helpers ----------------------------------------------------

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
