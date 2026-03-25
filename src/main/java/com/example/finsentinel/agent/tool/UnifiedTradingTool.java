package com.example.finsentinel.agent.tool;

import com.example.finsentinel.model.enums.TradingMode;
import com.example.finsentinel.repository.TradeWalletRepository;
import com.example.finsentinel.service.trading.engine.MarketClock;
import com.example.finsentinel.service.trading.uta.BrokerRegistry;
import com.example.finsentinel.service.trading.uta.Contract;
import com.example.finsentinel.service.trading.uta.IBroker;
import com.example.finsentinel.service.trading.uta.UnifiedTradeOperation;
import com.example.finsentinel.service.trading.uta.UnifiedTradingService;
import com.example.finsentinel.util.SecurityUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Unified AI agent tool for trading across all asset classes and brokers.
 *
 * <p>Replaces both {@code TradingTool} (paper/stock) and {@code OkxTradingTool}
 * (crypto derivatives) with a single tool surface. The AI provides a symbol string
 * and the system automatically resolves the correct broker via {@link BrokerRegistry}
 * and {@link Contract}-based routing.
 *
 * <p>Exposes 11 tools to the LLM covering the full stage/commit/execute lifecycle,
 * portfolio queries, asset search, market hours, order sync, and mode switching.
 *
 * <p>User identity is resolved from Spring Security's SecurityContext — never from
 * LLM-provided parameters — to prevent cross-user operations.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class UnifiedTradingTool {

    private final UnifiedTradingService tradingService;
    private final BrokerRegistry brokerRegistry;
    private final TradeWalletRepository tradeWalletRepository;

    // ── 1. Stage Order ──────────────────────────────────────────────────

    @Tool(description = "Stage a trade order for any asset. The symbol can be a stock ticker (AAPL), " +
            "crypto perpetual (BTC-USDT-SWAP), or crypto spot pair (BTC/USD). The system automatically " +
            "routes to the correct broker. Action must be BUY, SELL, or CLOSE. Specify either qty " +
            "(number of shares/contracts) or amount (dollar amount). Price is optional — null means market order.")
    public String stageOrder(
            @ToolParam(description = "Trade action: BUY, SELL, or CLOSE") String action,
            @ToolParam(description = "Asset symbol, e.g. AAPL, BTC-USDT-SWAP, BTC/USD") String symbol,
            @ToolParam(description = "Number of shares/contracts, or null if specifying amount") String qty,
            @ToolParam(description = "Dollar amount, or null if specifying qty") String amount,
            @ToolParam(description = "Limit price, or null for market order") String price) {
        try {
            UUID userId = getUserId();
            BigDecimal parsedQty = parseBigDecimal(qty);
            BigDecimal parsedAmount = parseBigDecimal(amount);
            BigDecimal parsedPrice = parseBigDecimal(price);

            Contract contract = Contract.fromString(symbol);
            UnifiedTradeOperation op = new UnifiedTradeOperation(
                    action.toUpperCase().trim(),
                    contract,
                    parsedQty,
                    parsedAmount,
                    parsedPrice
            );

            return tradingService.stage(userId, op);
        } catch (IllegalArgumentException e) {
            log.error("Invalid stage request: {}", e.getMessage());
            return "Error staging order: " + e.getMessage();
        } catch (Exception e) {
            log.error("Failed to stage order", e);
            return "Error staging order: " + e.getMessage();
        }
    }

    // ── 2. Commit Trade ─────────────────────────────────────────────────

    @Tool(description = "Commit all staged orders with a rationale message. This creates an immutable " +
            "commit with SHA-256 hash. Must be called after staging and before executing.")
    public String commitTrade(
            @ToolParam(description = "Commit message explaining the trading rationale, " +
                    "e.g. 'Going long BTC based on bullish breakout and strong funding rate'") String message) {
        try {
            UUID userId = getUserId();
            return tradingService.commit(userId, message);
        } catch (IllegalArgumentException e) {
            log.error("Invalid commit request: {}", e.getMessage());
            return "Error committing trade: " + e.getMessage();
        } catch (Exception e) {
            log.error("Failed to commit trade", e);
            return "Error committing trade: " + e.getMessage();
        }
    }

    // ── 3. Execute Trade ────────────────────────────────────────────────

    @Tool(description = "Execute the last committed trade. Each staged order is routed to the " +
            "appropriate broker automatically. Paper mode simulates; live mode hits the real broker.")
    public String executeTrade() {
        try {
            UUID userId = getUserId();
            return tradingService.execute(userId);
        } catch (IllegalArgumentException e) {
            log.error("Invalid execute request: {}", e.getMessage());
            return "Error executing trade: " + e.getMessage();
        } catch (Exception e) {
            log.error("Failed to execute trade", e);
            return "Error executing trade: " + e.getMessage();
        }
    }

    // ── 4. Wallet Status ────────────────────────────────────────────────

    @Tool(description = "Get unified portfolio status across all connected brokers. Shows cash balance, " +
            "positions with current prices and P/L, total portfolio value, and return percentage.")
    public String getWalletStatus() {
        try {
            UUID userId = getUserId();
            return tradingService.getWalletStatus(userId);
        } catch (Exception e) {
            log.error("Failed to get wallet status", e);
            return "Error fetching wallet status: " + e.getMessage();
        }
    }

    // ── 5. Get Positions ────────────────────────────────────────────────

    @Tool(description = "Get all current positions across all brokers. Shows symbol, quantity, " +
            "entry price, current price, P/L for each position.")
    public String getPositions() {
        try {
            UUID userId = getUserId();
            String walletStatus = tradingService.getWalletStatus(userId);
            // Extract the positions section from the full wallet status
            int positionsIdx = walletStatus.indexOf("--- Positions ---");
            int totalIdx = walletStatus.indexOf("\nTotal Portfolio Value:");
            if (positionsIdx >= 0 && totalIdx >= 0) {
                return "=== Current Positions ===\n" + walletStatus.substring(positionsIdx, totalIdx);
            }
            // Fallback: return the full status if we can't parse sections
            return walletStatus;
        } catch (Exception e) {
            log.error("Failed to get positions", e);
            return "Error fetching positions: " + e.getMessage();
        }
    }

    // ── 6. Trade History ────────────────────────────────────────────────

    @Tool(description = "Get the commit log showing recent trade history. Each entry shows the " +
            "commit hash, message, timestamp, and operations. Default limit: 10.")
    public String getTradeHistory(
            @ToolParam(description = "Number of recent commits to show (max 50)") int limit) {
        try {
            UUID userId = getUserId();
            int clampedLimit = Math.min(Math.max(limit, 1), 50);
            return tradingService.getCommitLog(userId, clampedLimit);
        } catch (Exception e) {
            log.error("Failed to get trade history", e);
            return "Error fetching trade history: " + e.getMessage();
        }
    }

    // ── 7. Staged Orders ────────────────────────────────────────────────

    @Tool(description = "View all currently staged (uncommitted) orders. Shows the asset, action, " +
            "quantity, and price for each staged order.")
    public String getStagedOrders() {
        try {
            UUID userId = getUserId();
            List<UnifiedTradeOperation> staged = tradingService.getStagingArea(userId);
            if (staged.isEmpty()) {
                return "No staged orders. Use stageOrder to queue trades.";
            }
            StringBuilder sb = new StringBuilder();
            sb.append("=== Staged Orders ===\n");
            for (int i = 0; i < staged.size(); i++) {
                UnifiedTradeOperation op = staged.get(i);
                sb.append(String.format("  %d. %s %s", i + 1, op.action(), op.contract().displayName()));
                if (op.qty() != null) sb.append(String.format(" (%s units)", op.qty().toPlainString()));
                if (op.notional() != null) sb.append(String.format(" ($%s)", op.notional().toPlainString()));
                if (op.price() != null) sb.append(String.format(" @ $%s", op.price().toPlainString()));
                sb.append("\n");
            }
            sb.append(String.format("\n%d order%s staged. Call commitTrade to commit.",
                    staged.size(), staged.size() == 1 ? "" : "s"));
            return sb.toString();
        } catch (Exception e) {
            log.error("Failed to get staged orders", e);
            return "Error fetching staged orders: " + e.getMessage();
        }
    }

    // ── 8. Search Assets ────────────────────────────────────────────────

    @Tool(description = "Search for tradable assets across all connected brokers. Use this to find " +
            "and compare assets cross-market (e.g., search 'gold' to find GLD ETF, GC futures, " +
            "PAXG crypto). Returns a list of matching Contracts with their broker and security type.")
    public String searchAssets(
            @ToolParam(description = "Search query, e.g. 'gold', 'BTC', 'AAPL'") String query) {
        try {
            UUID userId = getUserId();
            return tradingService.searchAssets(userId, query);
        } catch (Exception e) {
            log.error("Failed to search assets for query '{}'", query, e);
            return "Error searching assets: " + e.getMessage();
        }
    }

    // ── 9. Check Market Hours ───────────────────────────────────────────

    @Tool(description = "Check if markets are currently open. Returns open/close status and " +
            "next open/close times for the primary broker.")
    public String checkMarketHours() {
        try {
            UUID userId = getUserId();
            var wallet = tradeWalletRepository.findByUserId(userId);
            TradingMode mode = wallet.map(w -> w.getTradingMode()).orElse(TradingMode.PAPER);
            BigDecimal cash = wallet.map(w -> w.getCashBalance()).orElse(new BigDecimal("100000"));

            // Pick the first available broker rather than hardcoding STOCK
            List<IBroker> brokers = brokerRegistry.listAvailableBrokers(mode, cash);
            if (brokers.isEmpty()) {
                return "No brokers available. Configure broker credentials or switch to PAPER mode.";
            }
            IBroker broker = brokers.getFirst();
            MarketClock clock = broker.getMarketClock();

            StringBuilder sb = new StringBuilder();
            sb.append(String.format("Market is %s\n", clock.isOpen() ? "OPEN" : "CLOSED"));
            if (clock.nextOpen() != null) {
                sb.append(String.format("Next open:  %s\n", clock.nextOpen()));
            }
            if (clock.nextClose() != null) {
                sb.append(String.format("Next close: %s\n", clock.nextClose()));
            }
            sb.append(String.format("Broker: %s\n", broker.displayName()));
            return sb.toString();
        } catch (Exception e) {
            log.error("Failed to check market hours", e);
            return "Error checking market hours: " + e.getMessage();
        }
    }

    // ── 10. Sync Orders ─────────────────────────────────────────────────

    @Tool(description = "Sync wallet with broker order status. Polls the broker for latest " +
            "order fills and status changes.")
    public String syncOrders() {
        try {
            UUID userId = getUserId();
            var wallet = tradeWalletRepository.findByUserId(userId);
            TradingMode mode = wallet.map(w -> w.getTradingMode()).orElse(TradingMode.PAPER);
            BigDecimal cash = wallet.map(w -> w.getCashBalance()).orElse(new BigDecimal("100000"));

            List<IBroker> brokers = brokerRegistry.listAvailableBrokers(mode, cash);
            if (brokers.isEmpty()) {
                return "No brokers available. Configure broker credentials or switch to PAPER mode.";
            }
            IBroker broker = brokers.getFirst();
            var orders = broker.syncOrders();

            if (orders.isEmpty()) {
                return "No pending orders to sync. Wallet is up to date.";
            }

            StringBuilder sb = new StringBuilder();
            sb.append("=== Order Sync Results ===\n");
            sb.append(String.format("Broker: %s\n\n", broker.displayName()));
            for (var order : orders) {
                sb.append(String.format("  Order %s: %s (filled: %s @ $%s)\n",
                        order.orderId() != null ? order.orderId() : "-",
                        order.success() ? "FILLED" : order.status(),
                        order.filledQty() != null ? order.filledQty().toPlainString() : "0",
                        order.filledPrice() != null ? order.filledPrice().toPlainString() : "-"));
            }
            sb.append(String.format("\n%d order(s) synced.", orders.size()));
            return sb.toString();
        } catch (Exception e) {
            log.error("Failed to sync orders", e);
            return "Error syncing orders: " + e.getMessage();
        }
    }

    // ── 11. Switch Trading Mode ─────────────────────────────────────────

    @Tool(description = "Switch between PAPER (simulated) and LIVE (real broker) trading mode. " +
            "WARNING: LIVE mode executes real trades with real money.")
    public String switchTradingMode(
            @ToolParam(description = "Trading mode: PAPER or LIVE") String mode) {
        try {
            UUID userId = getUserId();
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

    // ── Helpers ──────────────────────────────────────────────────────────

    private UUID getUserId() {
        return SecurityUtils.getCurrentUserId();
    }

    private BigDecimal parseBigDecimal(String value) {
        if (value == null || value.isBlank() || "null".equalsIgnoreCase(value)) {
            return null;
        }
        try {
            return new BigDecimal(value);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Invalid numeric value: '" + value + "'");
        }
    }
}
