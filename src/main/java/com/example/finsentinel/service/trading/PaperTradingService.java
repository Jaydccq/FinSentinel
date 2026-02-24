package com.example.finsentinel.service.trading;

import com.example.finsentinel.model.TradeOperation;
import com.example.finsentinel.model.TradeWallet;
import com.example.finsentinel.model.User;
import com.example.finsentinel.model.enums.TradingMode;
import com.example.finsentinel.repository.TradeWalletRepository;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.MarketDataService;
import com.example.finsentinel.service.trading.engine.*;
import com.example.finsentinel.util.HashUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.Duration;
import java.util.*;

import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Core paper trading service implementing the OpenAlice git-like wallet workflow.
 *
 * <p>The three-phase trading lifecycle:
 * <ol>
 *   <li><b>Stage</b> -- add trade operations to an in-memory staging area (like {@code git add})</li>
 *   <li><b>Commit</b> -- seal staged operations with a rationale message (like {@code git commit})</li>
 *   <li><b>Execute</b> -- simulate trades against current market prices (like {@code git push})</li>
 * </ol>
 *
 * <p>Every executed commit is recorded as an immutable entry in the wallet's JSONB
 * commit history, providing a full audit trail of what was traded, why, and what happened.
 *
 * <p>This class is part of the service layer in FinSentinel.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class PaperTradingService {

    private final TradeWalletRepository walletRepository;
    private final UserRepository userRepository;
    private final MarketDataService marketDataService;
    private final TradingEngineFactory engineFactory;
    private final StringRedisTemplate redisTemplate;

    private static final ObjectMapper objectMapper = JsonMapper.builder().build();

    private static final String STAGING_KEY_PREFIX = "trading:staging:";
    private static final String PENDING_KEY_PREFIX = "trading:pending:";
    private static final Duration STATE_TTL = Duration.ofMinutes(30);

    private static final int MAX_COMMIT_HISTORY = 100;
    private static final DateTimeFormatter TIMESTAMP_FMT = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    // ─────────────────────────── Wallet lifecycle ────────────────────────────

    /**
     * Retrieves the user's paper trading wallet, creating one with $100,000 if none exists.
     *
     * @param userId the user's UUID
     * @return the user's trade wallet
     */
    @Transactional
    public TradeWallet getOrCreateWallet(UUID userId) {
        return walletRepository.findByUserId(userId).orElseGet(() -> {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new IllegalArgumentException("User not found: " + userId));
            TradeWallet wallet = TradeWallet.builder()
                    .user(user)
                    .build();
            log.info("Created paper trading wallet for user {}", userId);
            return walletRepository.save(wallet);
        });
    }

    /**
     * Switches the trading mode for a user's wallet (PAPER or LIVE).
     *
     * @param userId the user's UUID
     * @param mode   the desired trading mode
     */
    @Transactional
    public void switchMode(UUID userId, TradingMode mode) {
        TradeWallet wallet = getOrCreateWallet(userId);
        wallet.setTradingMode(mode);
        walletRepository.save(wallet);
        log.info("User {} switched trading mode to {}", userId, mode);
    }

    // ───────────────────────── Phase 1: Stage ───────────────────────────────

    /**
     * Stages a trade operation in the user's in-memory staging area.
     *
     * <p>Similar to {@code git add} -- the operation is recorded but not executed.
     * Validates ticker format and that shares/amount are positive.
     *
     * @param userId    the user's UUID
     * @param operation the trade operation to stage
     * @return confirmation message with staging area count
     */
    public String stage(UUID userId, TradeOperation operation) {
        validateOperation(operation);

        List<TradeOperation> staging = getRedisStaging(userId);
        staging.add(operation);
        saveRedisStaging(userId, staging);

        int count = staging.size();
        String detail = formatOperationSummary(operation);
        log.info("User {} staged operation: {} ({} total staged)", userId, detail, count);
        return String.format("Staged: %s (%d operation%s staged)", detail, count, count == 1 ? "" : "s");
    }

    /**
     * Returns the current staging area for a user (like {@code git status}).
     *
     * @param userId the user's UUID
     * @return list of staged operations, empty if none
     */
    public List<TradeOperation> getStagingArea(UUID userId) {
        return getRedisStaging(userId);
    }

    // ───────────────────────── Phase 2: Commit ──────────────────────────────

    /**
     * Commits the staged operations with a rationale message.
     *
     * <p>Similar to {@code git commit} -- seals the staged operations into a commit
     * record with a hash, but does NOT execute them. Call {@link #execute(UUID)} next.
     *
     * @param userId  the user's UUID
     * @param message the commit message explaining the trading rationale
     * @return confirmation with commit hash and operation count
     */
    public String commit(UUID userId, String message) {
        List<TradeOperation> staged = getRedisStaging(userId);
        if (staged == null || staged.isEmpty()) {
            return "Error: Nothing to commit. Stage orders first with stageTradeOrder.";
        }
        if (message == null || message.isBlank()) {
            return "Error: Commit message is required. Explain your trading rationale.";
        }

        // Generate commit hash
        String timestamp = LocalDateTime.now().format(TIMESTAMP_FMT);
        String hashInput = message + "|" + staged.toString() + "|" + timestamp;
        String hash = HashUtils.sha256(hashInput);

        // Build commit metadata (not yet persisted -- pending until execute)
        List<Map<String, Object>> operationMaps = staged.stream()
                .map(this::operationToMap)
                .toList();

        Map<String, Object> commitData = new LinkedHashMap<>();
        commitData.put("hash", hash);
        commitData.put("message", message);
        commitData.put("timestamp", timestamp);
        commitData.put("operations", operationMaps);

        saveRedisPendingCommit(userId, commitData);

        int opCount = staged.size();
        log.info("User {} committed: {} -- {} ({} operations)", userId, hash, message, opCount);
        return String.format("Committed: %s -- %s (%d operation%s). Call executeTrade to finalize.",
                hash, message, opCount, opCount == 1 ? "" : "s");
    }

    // ───────────────────────── Phase 3: Execute ─────────────────────────────

    /**
     * Executes the pending commit by delegating to the appropriate {@link TradingEngine}.
     *
     * <p>Similar to {@code git push} -- finalizes the committed trades. The wallet's
     * {@code tradingMode} determines which engine is used:
     * <ul>
     *   <li><b>PAPER</b> -- simulates trades at current market prices via {@link PaperTradingEngine}</li>
     *   <li><b>LIVE</b> -- executes real trades via Alpaca (US equities) or crypto exchange</li>
     * </ul>
     *
     * <p>For paper mode, the engine's in-memory state is synchronised from and back to
     * the wallet's persisted JSONB columns, ensuring consistency across sessions.
     *
     * @param userId the user's UUID
     * @return formatted execution report with results for each operation
     */
    @Transactional
    public String execute(UUID userId) {
        Map<String, Object> commitData = getRedisPendingCommit(userId);
        if (commitData == null) {
            return "Error: No pending commit. Stage orders and commit first.";
        }
        try {
            TradeWallet wallet = getOrCreateWallet(userId);

            // Create the appropriate engine based on wallet trading mode
            TradingEngine engine = engineFactory.createEngine(wallet.getTradingMode(), wallet.getCashBalance());

            // For paper engine, sync wallet state into the engine
            if (engine instanceof PaperTradingEngine paperEngine) {
                paperEngine.setCash(wallet.getCashBalance());
                paperEngine.setPositions(wallet.getPositions());
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> operations = (List<Map<String, Object>>) commitData.get("operations");

            List<Map<String, Object>> results = new ArrayList<>();
            StringBuilder report = new StringBuilder();
            report.append("=== Execution Report ===\n");
            report.append(String.format("Engine: %s\n", engine.engineName()));
            report.append(String.format("Commit: %s -- %s\n\n", commitData.get("hash"), commitData.get("message")));

            for (Map<String, Object> op : operations) {
                String action = (String) op.get("action");
                String ticker = (String) op.get("ticker");
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("action", action);
                result.put("ticker", ticker);

                try {
                    OrderRequest orderRequest = toOrderRequest(op);
                    OrderResult orderResult = engine.placeOrder(orderRequest);

                    result.put("success", orderResult.success());
                    if (orderResult.success()) {
                        result.put("filledPrice", orderResult.filledPrice());
                        result.put("shares", orderResult.filledQty());
                        if ("sell".equalsIgnoreCase(orderRequest.side())) {
                            BigDecimal proceeds = orderResult.filledQty()
                                    .multiply(orderResult.filledPrice())
                                    .setScale(2, RoundingMode.HALF_UP);
                            result.put("proceeds", proceeds);
                            report.append(String.format("  %s %s shares of %s @ $%s = $%s\n",
                                    action, orderResult.filledQty().toPlainString(), ticker,
                                    orderResult.filledPrice().toPlainString(), proceeds.toPlainString()));
                        } else {
                            BigDecimal cost = orderResult.filledQty()
                                    .multiply(orderResult.filledPrice())
                                    .setScale(2, RoundingMode.HALF_UP);
                            result.put("cost", cost);
                            report.append(String.format("  %s %s shares of %s @ $%s = $%s\n",
                                    action, orderResult.filledQty().toPlainString(), ticker,
                                    orderResult.filledPrice().toPlainString(), cost.toPlainString()));
                        }
                    } else {
                        result.put("error", orderResult.error());
                        report.append(String.format("  FAILED %s %s: %s\n", action, ticker, orderResult.error()));
                    }
                } catch (Exception e) {
                    result.put("success", false);
                    result.put("error", e.getMessage());
                    report.append(String.format("  FAILED %s %s: %s\n", action, ticker, e.getMessage()));
                    log.error("Error executing {} {} for user {}", action, ticker, userId, e);
                }
                results.add(result);
            }

            // For paper engine, sync results back to wallet
            if (engine instanceof PaperTradingEngine paperEngine) {
                wallet.setCashBalance(paperEngine.getCash());
                wallet.setPositions(paperEngine.getPositionMaps());
            }

            // Record commit in history
            String parentHash = wallet.getCommitHistory().isEmpty()
                    ? null
                    : (String) wallet.getCommitHistory().getLast().get("hash");

            Map<String, Object> historyEntry = new LinkedHashMap<>(commitData);
            historyEntry.put("parentHash", parentHash);
            historyEntry.put("results", results);
            historyEntry.put("walletStateAfter", buildWalletSnapshot(wallet));

            List<Map<String, Object>> history = new ArrayList<>(wallet.getCommitHistory());
            history.add(historyEntry);
            // Cap at MAX_COMMIT_HISTORY entries
            if (history.size() > MAX_COMMIT_HISTORY) {
                history = new ArrayList<>(history.subList(history.size() - MAX_COMMIT_HISTORY, history.size()));
            }
            wallet.setCommitHistory(history);

            walletRepository.save(wallet);

            report.append(String.format("\nCash balance: $%s\n", wallet.getCashBalance().toPlainString()));
            report.append(String.format("Positions: %d\n", wallet.getPositions().size()));

            log.info("User {} executed commit {} via {}: {} operations",
                    userId, commitData.get("hash"), engine.engineName(), results.size());
            return report.toString();
        } finally {
            // Ensure Redis state does not get stuck when execution fails unexpectedly.
            clearRedisStaging(userId);
            clearRedisPendingCommit(userId);
        }
    }

    // ───────────────────────── Query methods ─────────────────────────────────

    /**
     * Returns a formatted summary of the wallet's current state including
     * cash balance, positions with P/L, and total portfolio value.
     *
     * @param userId the user's UUID
     * @return formatted wallet status string
     */
    @Transactional
    public String getWalletStatus(UUID userId) {
        TradeWallet wallet = getOrCreateWallet(userId);

        StringBuilder sb = new StringBuilder();
        sb.append("=== Paper Trading Wallet ===\n");
        sb.append(String.format("Initial Capital: $%s\n", wallet.getInitialCapital().toPlainString()));
        sb.append(String.format("Cash Balance:    $%s\n", wallet.getCashBalance().toPlainString()));
        sb.append("\n--- Positions ---\n");

        BigDecimal totalPositionValue = BigDecimal.ZERO;

        if (wallet.getPositions().isEmpty()) {
            sb.append("  (no open positions)\n");
        } else {
            for (Map<String, Object> pos : wallet.getPositions()) {
                String ticker = (String) pos.get("ticker");
                BigDecimal shares = toBigDecimal(pos.get("shares"));
                BigDecimal avgCost = toBigDecimal(pos.get("avgCost"));
                BigDecimal currentPrice;

                try {
                    currentPrice = getCurrentPrice(ticker);
                    // Update stored current price
                    pos.put("currentPrice", currentPrice);
                } catch (Exception e) {
                    // Fall back to last known price
                    currentPrice = pos.containsKey("currentPrice")
                            ? toBigDecimal(pos.get("currentPrice"))
                            : avgCost;
                    log.warn("Could not fetch current price for {}, using last known: {}", ticker, currentPrice);
                }

                BigDecimal posValue = shares.multiply(currentPrice).setScale(2, RoundingMode.HALF_UP);
                BigDecimal costBasis = shares.multiply(avgCost).setScale(2, RoundingMode.HALF_UP);
                BigDecimal pnl = posValue.subtract(costBasis);
                BigDecimal pnlPct = costBasis.compareTo(BigDecimal.ZERO) > 0
                        ? pnl.divide(costBasis, 4, RoundingMode.HALF_UP).multiply(new BigDecimal("100"))
                        : BigDecimal.ZERO;

                totalPositionValue = totalPositionValue.add(posValue);

                sb.append(String.format("  %s: %s shares @ avg $%s | Current: $%s | Value: $%s | P&L: %s$%s (%.2f%%)\n",
                        ticker, shares.toPlainString(), avgCost.toPlainString(),
                        currentPrice.toPlainString(), posValue.toPlainString(),
                        pnl.signum() >= 0 ? "+" : "-",
                        pnl.abs().toPlainString(), pnlPct.doubleValue()));
            }
        }

        BigDecimal totalValue = wallet.getCashBalance().add(totalPositionValue);
        BigDecimal totalReturn = totalValue.subtract(wallet.getInitialCapital());
        BigDecimal totalReturnPct = wallet.getInitialCapital().compareTo(BigDecimal.ZERO) > 0
                ? totalReturn.divide(wallet.getInitialCapital(), 4, RoundingMode.HALF_UP)
                    .multiply(new BigDecimal("100"))
                : BigDecimal.ZERO;

        sb.append(String.format("\nTotal Portfolio Value: $%s\n", totalValue.toPlainString()));
        sb.append(String.format("Overall Return: %s$%s (%.2f%%)\n",
                totalReturn.signum() >= 0 ? "+" : "-",
                totalReturn.abs().toPlainString(), totalReturnPct.doubleValue()));

        // Save updated current prices
        walletRepository.save(wallet);

        return sb.toString();
    }

    /**
     * Returns the last N commits from the wallet's history (like {@code git log}).
     *
     * @param userId the user's UUID
     * @param limit  maximum number of commits to return
     * @return formatted commit log
     */
    @Transactional
    public String getCommitLog(UUID userId, int limit) {
        TradeWallet wallet = getOrCreateWallet(userId);
        List<Map<String, Object>> history = wallet.getCommitHistory();

        if (history.isEmpty()) {
            return "No trade history yet. Stage, commit, and execute your first trade.";
        }

        limit = Math.min(Math.max(limit, 1), history.size());
        List<Map<String, Object>> recent = history.subList(history.size() - limit, history.size());

        StringBuilder sb = new StringBuilder();
        sb.append("=== Trade Commit Log ===\n\n");

        // Display in reverse chronological order
        for (int i = recent.size() - 1; i >= 0; i--) {
            Map<String, Object> entry = recent.get(i);
            sb.append(String.format("commit %s", entry.get("hash")));
            if (entry.get("parentHash") != null) {
                sb.append(String.format(" (parent: %s)", entry.get("parentHash")));
            }
            sb.append("\n");
            sb.append(String.format("Date:    %s\n", entry.get("timestamp")));
            sb.append(String.format("Message: %s\n", entry.get("message")));

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> ops = (List<Map<String, Object>>) entry.get("operations");
            if (ops != null) {
                sb.append("Operations:\n");
                for (Map<String, Object> op : ops) {
                    sb.append(String.format("  %s %s", op.get("action"), op.get("ticker")));
                    if (op.get("shares") != null) {
                        sb.append(String.format(" (%s shares)", op.get("shares")));
                    }
                    sb.append("\n");
                }
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> results = (List<Map<String, Object>>) entry.get("results");
            if (results != null) {
                sb.append("Results:\n");
                for (Map<String, Object> res : results) {
                    boolean success = Boolean.TRUE.equals(res.get("success"));
                    if (success) {
                        sb.append(String.format("  OK %s %s: %s shares @ $%s\n",
                                res.get("action"), res.get("ticker"),
                                res.get("shares"), res.get("filledPrice")));
                    } else {
                        sb.append(String.format("  FAIL %s %s: %s\n",
                                res.get("action"), res.get("ticker"), res.get("error")));
                    }
                }
            }
            sb.append("\n");
        }

        return sb.toString();
    }

    /**
     * Simulates the impact of a hypothetical price change on the portfolio.
     *
     * <p>Does NOT modify any positions -- purely hypothetical what-if analysis.
     *
     * @param userId        the user's UUID
     * @param ticker        the ticker to simulate a price change for
     * @param changePercent the percentage change to simulate (e.g., -10.0 for a 10% drop)
     * @return formatted impact analysis
     */
    @Transactional
    public String simulatePriceChange(UUID userId, String ticker, double changePercent) {
        TradeWallet wallet = getOrCreateWallet(userId);
        final String normalizedTicker = ticker.toUpperCase().trim();

        Map<String, Object> position = findPosition(wallet, normalizedTicker);
        if (position == null) {
            return String.format("No position in %s to simulate. Current positions: %s",
                    normalizedTicker,
                    wallet.getPositions().stream()
                            .map(p -> (String) p.get("ticker"))
                            .toList());
        }

        BigDecimal shares = toBigDecimal(position.get("shares"));
        BigDecimal avgCost = toBigDecimal(position.get("avgCost"));

        BigDecimal currentPrice;
        try {
            currentPrice = getCurrentPrice(normalizedTicker);
        } catch (Exception e) {
            currentPrice = position.containsKey("currentPrice")
                    ? toBigDecimal(position.get("currentPrice"))
                    : avgCost;
        }

        BigDecimal changeFactor = BigDecimal.ONE.add(
                new BigDecimal(changePercent).divide(new BigDecimal("100"), 6, RoundingMode.HALF_UP));
        BigDecimal hypotheticalPrice = currentPrice.multiply(changeFactor).setScale(2, RoundingMode.HALF_UP);

        BigDecimal currentValue = shares.multiply(currentPrice).setScale(2, RoundingMode.HALF_UP);
        BigDecimal hypotheticalValue = shares.multiply(hypotheticalPrice).setScale(2, RoundingMode.HALF_UP);
        BigDecimal costBasis = shares.multiply(avgCost).setScale(2, RoundingMode.HALF_UP);

        BigDecimal currentPnl = currentValue.subtract(costBasis);
        BigDecimal hypotheticalPnl = hypotheticalValue.subtract(costBasis);
        BigDecimal valueDelta = hypotheticalValue.subtract(currentValue);

        BigDecimal totalPortfolio = wallet.getCashBalance().add(
                wallet.getPositions().stream()
                        .map(p -> {
                            BigDecimal s = toBigDecimal(p.get("shares"));
                            BigDecimal price = normalizedTicker.equals(p.get("ticker"))
                                    ? hypotheticalPrice
                                    : (p.containsKey("currentPrice")
                                        ? toBigDecimal(p.get("currentPrice"))
                                        : toBigDecimal(p.get("avgCost")));
                            return s.multiply(price).setScale(2, RoundingMode.HALF_UP);
                        })
                        .reduce(BigDecimal.ZERO, BigDecimal::add));

        return String.format("""
                === What-If Analysis: %s %s%.1f%% ===
                Current price:      $%s
                Hypothetical price: $%s

                Position: %s shares
                Cost basis:         $%s
                Current value:      $%s (P&L: %s$%s)
                Hypothetical value: $%s (P&L: %s$%s)
                Value change:       %s$%s

                Portfolio value (hypothetical): $%s""",
                normalizedTicker, changePercent >= 0 ? "+" : "", changePercent,
                currentPrice.toPlainString(),
                hypotheticalPrice.toPlainString(),
                shares.toPlainString(),
                costBasis.toPlainString(),
                currentValue.toPlainString(),
                currentPnl.signum() >= 0 ? "+" : "-", currentPnl.abs().toPlainString(),
                hypotheticalValue.toPlainString(),
                hypotheticalPnl.signum() >= 0 ? "+" : "-", hypotheticalPnl.abs().toPlainString(),
                valueDelta.signum() >= 0 ? "+" : "-", valueDelta.abs().toPlainString(),
                totalPortfolio.toPlainString());
    }

    // ───────────────────────── Redis state helpers ────────────────────────────

    private List<TradeOperation> getRedisStaging(UUID userId) {
        try {
            String json = redisTemplate.opsForValue().get(STAGING_KEY_PREFIX + userId);
            if (json == null) return new ArrayList<>();
            return objectMapper.readValue(json, new TypeReference<List<TradeOperation>>() {});
        } catch (Exception e) {
            log.warn("Failed to read staging from Redis for user {}", userId, e);
            return new ArrayList<>();
        }
    }

    private void saveRedisStaging(UUID userId, List<TradeOperation> ops) {
        try {
            String json = objectMapper.writeValueAsString(ops);
            redisTemplate.opsForValue().set(STAGING_KEY_PREFIX + userId, json, STATE_TTL);
        } catch (Exception e) {
            log.error("Failed to save staging to Redis for user {}", userId, e);
        }
    }

    private void clearRedisStaging(UUID userId) {
        redisTemplate.delete(STAGING_KEY_PREFIX + userId);
    }

    private Map<String, Object> getRedisPendingCommit(UUID userId) {
        try {
            String json = redisTemplate.opsForValue().get(PENDING_KEY_PREFIX + userId);
            if (json == null) return null;
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            log.warn("Failed to read pending commit from Redis for user {}", userId, e);
            return null;
        }
    }

    private void saveRedisPendingCommit(UUID userId, Map<String, Object> commitData) {
        try {
            String json = objectMapper.writeValueAsString(commitData);
            redisTemplate.opsForValue().set(PENDING_KEY_PREFIX + userId, json, STATE_TTL);
        } catch (Exception e) {
            log.error("Failed to save pending commit to Redis for user {}", userId, e);
        }
    }

    private void clearRedisPendingCommit(UUID userId) {
        redisTemplate.delete(PENDING_KEY_PREFIX + userId);
    }

    // ───────────────────────── Internal helpers ──────────────────────────────

    /**
     * Converts a commit operation map into an {@link OrderRequest} for the trading engine.
     */
    private OrderRequest toOrderRequest(Map<String, Object> op) {
        String action = (String) op.get("action");
        String ticker = (String) op.get("ticker");
        String side = "CLOSE".equals(action) || "SELL".equals(action) ? "sell" : "buy";
        BigDecimal shares = op.containsKey("shares") ? toBigDecimal(op.get("shares")) : null;
        BigDecimal amount = op.containsKey("amount") ? toBigDecimal(op.get("amount")) : null;
        BigDecimal price = op.containsKey("price") ? toBigDecimal(op.get("price")) : null;
        String type = price != null ? "limit" : "market";

        return new OrderRequest(ticker, side, type, shares, amount, price, null, "day",
                "CLOSE".equals(action));
    }

    private void validateOperation(TradeOperation operation) {
        if (operation.action() == null || operation.action().isBlank()) {
            throw new IllegalArgumentException("Trade action is required (BUY, SELL, or CLOSE)");
        }
        String action = operation.action().toUpperCase().trim();
        if (!action.equals("BUY") && !action.equals("SELL") && !action.equals("CLOSE")) {
            throw new IllegalArgumentException("Invalid action: " + action + ". Must be BUY, SELL, or CLOSE");
        }
        if (operation.ticker() == null || !operation.ticker().matches("^[A-Za-z]{1,10}(/[A-Za-z]{1,5})?$")) {
            throw new IllegalArgumentException("Invalid ticker: " + operation.ticker() + ". Must be 1-10 letters, optionally with /PAIR");
        }
        if (!action.equals("CLOSE")) {
            if ((operation.shares() == null || operation.shares().compareTo(BigDecimal.ZERO) <= 0)
                    && (operation.amount() == null || operation.amount().compareTo(BigDecimal.ZERO) <= 0)) {
                throw new IllegalArgumentException("Either shares or amount must be positive for " + action);
            }
        }
    }

    private BigDecimal getCurrentPrice(String ticker) {
        Map<String, Object> quote = marketDataService.getQuote(ticker);
        Object closePrice = quote.get("close");
        if (closePrice == null) {
            throw new IllegalStateException("No price data available for " + ticker);
        }
        return toBigDecimal(closePrice);
    }

    private Map<String, Object> findPosition(TradeWallet wallet, String ticker) {
        return wallet.getPositions().stream()
                .filter(p -> ticker.equalsIgnoreCase((String) p.get("ticker")))
                .findFirst()
                .orElse(null);
    }

    private Map<String, Object> buildWalletSnapshot(TradeWallet wallet) {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("cashBalance", wallet.getCashBalance());
        snapshot.put("positions", new ArrayList<>(wallet.getPositions()));
        return snapshot;
    }

    private Map<String, Object> operationToMap(TradeOperation op) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("action", op.action().toUpperCase().trim());
        map.put("ticker", op.ticker().toUpperCase().trim());
        if (op.shares() != null) map.put("shares", op.shares());
        if (op.amount() != null) map.put("amount", op.amount());
        if (op.price() != null) map.put("price", op.price());
        return map;
    }

    private String formatOperationSummary(TradeOperation op) {
        String action = op.action().toUpperCase().trim();
        String ticker = op.ticker().toUpperCase().trim();
        if (action.equals("CLOSE")) {
            return "CLOSE all shares of " + ticker;
        }
        if (op.shares() != null && op.shares().compareTo(BigDecimal.ZERO) > 0) {
            return String.format("%s %s shares of %s", action, op.shares().toPlainString(), ticker);
        }
        if (op.amount() != null && op.amount().compareTo(BigDecimal.ZERO) > 0) {
            return String.format("%s $%s of %s", action, op.amount().toPlainString(), ticker);
        }
        return action + " " + ticker;
    }

    private BigDecimal toBigDecimal(Object value) {
        if (value == null) return BigDecimal.ZERO;
        if (value instanceof BigDecimal bd) return bd;
        if (value instanceof Number n) return new BigDecimal(n.toString());
        return new BigDecimal(value.toString());
    }

}
