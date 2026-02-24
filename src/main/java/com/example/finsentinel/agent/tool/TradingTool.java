package com.example.finsentinel.agent.tool;

import com.example.finsentinel.model.TradeOperation;
import com.example.finsentinel.model.enums.TradingMode;
import com.example.finsentinel.service.trading.PaperTradingService;
import com.example.finsentinel.util.SecurityUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * AI agent tool for paper trading using the OpenAlice git-like wallet pattern.
 *
 * <p>Exposes a three-phase trading workflow to the LLM:
 * <ol>
 *   <li><b>Stage</b> -- queue trade orders without executing (like {@code git add})</li>
 *   <li><b>Commit</b> -- seal orders with a rationale message (like {@code git commit})</li>
 *   <li><b>Execute</b> -- simulate trades at current prices (like {@code git push})</li>
 * </ol>
 *
 * <p>This deliberate three-step process ensures every trading decision has a recorded
 * rationale and can be reviewed before execution. The full commit history provides
 * an immutable audit trail.
 *
 * <p>User identity is resolved from Spring Security's SecurityContext -- never from
 * LLM-provided parameters -- to prevent cross-user operations.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class TradingTool {

    private final PaperTradingService tradingService;

    @Tool(description = "Stage a paper trade order. The order is NOT executed yet -- call commitTrade " +
            "and then executeTrade to finalize. Actions: BUY (buy shares), SELL (sell shares), " +
            "CLOSE (sell all shares of ticker). Specify either shares OR amount in dollars. " +
            "This works like 'git add' -- staging your intended trades before committing.")
    public String stageTradeOrder(
            @ToolParam(description = "Trade action: BUY, SELL, or CLOSE") String action,
            @ToolParam(description = "Stock ticker symbol, e.g. AAPL") String ticker,
            @ToolParam(description = "Number of shares (use 0 if specifying amount instead)") double shares,
            @ToolParam(description = "Dollar amount (use 0 if specifying shares instead)") double amount) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            TradeOperation operation = new TradeOperation(
                    action.toUpperCase().trim(),
                    ticker.toUpperCase().trim(),
                    shares > 0 ? BigDecimal.valueOf(shares) : null,
                    amount > 0 ? BigDecimal.valueOf(amount) : null,
                    null  // market order
            );
            return tradingService.stage(userId, operation);
        } catch (IllegalArgumentException e) {
            log.error("Invalid stage request: {}", e.getMessage());
            return "Error staging trade: " + e.getMessage();
        } catch (Exception e) {
            log.error("Failed to stage trade", e);
            return "Error staging trade: " + e.getMessage();
        }
    }

    @Tool(description = "Commit staged trade operations with a rationale message. Like 'git commit' -- " +
            "records your trading decision and reasoning. Must stage orders first with stageTradeOrder, " +
            "then commit, then execute with executeTrade.")
    public String commitTrade(
            @ToolParam(description = "Commit message explaining the trading rationale, " +
                    "e.g. 'Going long AAPL based on strong Q4 earnings and bullish technicals'") String message) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            return tradingService.commit(userId, message);
        } catch (IllegalArgumentException e) {
            log.error("Invalid commit request: {}", e.getMessage());
            return "Error committing trade: " + e.getMessage();
        } catch (Exception e) {
            log.error("Failed to commit trade", e);
            return "Error committing trade: " + e.getMessage();
        }
    }

    @Tool(description = "Execute the committed trade operations (paper trading -- simulated). " +
            "Like 'git push' -- finalizes the trade at current market prices. " +
            "Must commit first with commitTrade. Returns execution report with filled prices and P&L.")
    public String executeTrade() {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            return tradingService.execute(userId);
        } catch (IllegalArgumentException e) {
            log.error("Invalid execute request: {}", e.getMessage());
            return "Error executing trade: " + e.getMessage();
        } catch (Exception e) {
            log.error("Failed to execute trade", e);
            return "Error executing trade: " + e.getMessage();
        }
    }

    @Tool(description = "View paper trading portfolio status including cash balance, positions with " +
            "current prices and P&L, and total portfolio value with overall return percentage.")
    public String getWalletStatus() {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            return tradingService.getWalletStatus(userId);
        } catch (Exception e) {
            log.error("Failed to get wallet status", e);
            return "Error fetching wallet status: " + e.getMessage();
        }
    }

    @Tool(description = "View trade commit history -- a timeline of all trading decisions with rationale " +
            "and results. Like 'git log' -- shows what was traded, why, and what happened.")
    public String getTradeHistory(
            @ToolParam(description = "Number of recent commits to show (max 50)") int limit) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            int clampedLimit = Math.min(Math.max(limit, 1), 50);
            return tradingService.getCommitLog(userId, clampedLimit);
        } catch (Exception e) {
            log.error("Failed to get trade history", e);
            return "Error fetching trade history: " + e.getMessage();
        }
    }

    @Tool(description = "View currently staged (uncommitted) trade orders. Like 'git status' -- " +
            "shows what orders are queued but not yet committed or executed.")
    public String getStagedOrders() {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            var staged = tradingService.getStagingArea(userId);
            if (staged.isEmpty()) {
                return "No staged orders. Use stageTradeOrder to queue trades.";
            }
            StringBuilder sb = new StringBuilder();
            sb.append("=== Staged Orders ===\n");
            for (int i = 0; i < staged.size(); i++) {
                TradeOperation op = staged.get(i);
                sb.append(String.format("  %d. %s %s", i + 1, op.action(), op.ticker()));
                if (op.shares() != null) sb.append(String.format(" (%s shares)", op.shares().toPlainString()));
                if (op.amount() != null) sb.append(String.format(" ($%s)", op.amount().toPlainString()));
                sb.append("\n");
            }
            sb.append(String.format("\n%d order%s staged. Call commitTrade to commit.", staged.size(),
                    staged.size() == 1 ? "" : "s"));
            return sb.toString();
        } catch (Exception e) {
            log.error("Failed to get staged orders", e);
            return "Error fetching staged orders: " + e.getMessage();
        }
    }

    @Tool(description = "What-if analysis: simulate the impact of a price change on your portfolio. " +
            "Does NOT modify positions -- purely hypothetical. " +
            "Example: 'If AAPL drops 10%, what happens to my portfolio?'")
    public String simulateImpact(
            @ToolParam(description = "Stock ticker symbol to simulate price change for") String ticker,
            @ToolParam(description = "Percentage change to simulate, e.g. -10.0 for 10% drop, 15.0 for 15% gain") double changePercent) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            return tradingService.simulatePriceChange(userId, ticker, changePercent);
        } catch (IllegalArgumentException e) {
            log.error("Invalid simulate request: {}", e.getMessage());
            return "Error simulating impact: " + e.getMessage();
        } catch (Exception e) {
            log.error("Failed to simulate impact", e);
            return "Error simulating impact: " + e.getMessage();
        }
    }

    @Tool(description = "Switch between paper trading (simulated) and live trading (real broker). " +
            "PAPER mode simulates trades at current market prices with no real money. " +
            "LIVE mode executes real trades via Alpaca (US stocks) or crypto exchange. " +
            "WARNING: LIVE mode uses real money. Ensure broker API is configured.")
    public String switchTradingMode(
            @ToolParam(description = "Trading mode: PAPER or LIVE") String mode) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            TradingMode tradingMode = TradingMode.valueOf(mode.toUpperCase().trim());
            tradingService.switchMode(userId, tradingMode);
            return String.format("Trading mode switched to %s. %s",
                    tradingMode,
                    tradingMode == TradingMode.LIVE
                        ? "WARNING: Real money trades will be executed via broker."
                        : "Trades will be simulated against market prices.");
        } catch (IllegalArgumentException e) {
            return "Error: Invalid mode. Use PAPER or LIVE. " + e.getMessage();
        } catch (Exception e) {
            return "Error switching mode: " + e.getMessage();
        }
    }
}
