package com.example.finsentinel.service.trading.uta;

import com.example.finsentinel.model.TradeWallet;
import com.example.finsentinel.model.User;
import com.example.finsentinel.model.enums.AgentEventAggregateType;
import com.example.finsentinel.model.enums.AgentEventType;
import com.example.finsentinel.model.enums.TradingMode;
import com.example.finsentinel.repository.TradeWalletRepository;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.MarketDataService;
import com.example.finsentinel.service.event.AgentEventService;
import com.example.finsentinel.service.trading.engine.OrderRequest;
import com.example.finsentinel.service.trading.engine.OrderResult;
import com.example.finsentinel.util.HashUtils;
import com.example.finsentinel.util.NumberUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Unified Trading Account service — generalises the stage/commit/execute workflow
 * to work with ANY broker via {@link BrokerRegistry} and {@link Contract}-based
 * asset identification.
 *
 * <p>Mirrors the three-phase lifecycle from {@code PaperTradingService}:
 * <ol>
 *   <li><b>Stage</b> — add {@link UnifiedTradeOperation}s to Redis staging area</li>
 *   <li><b>Commit</b> — seal staged operations with a rationale message + SHA-256 hash</li>
 *   <li><b>Execute</b> — resolve broker via {@link BrokerRegistry}, execute, persist</li>
 * </ol>
 *
 * <p>For paper mode the engine's in-memory state is synchronised from/to the wallet's
 * persisted JSONB columns. For live brokers, orders are placed directly and wallet
 * state is managed by the external broker.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class UnifiedTradingService {

    private final BrokerRegistry brokerRegistry;
    private final TradeWalletRepository walletRepository;
    private final UserRepository userRepository;
    private final MarketDataService marketDataService;
    private final StringRedisTemplate redisTemplate;
    private final AgentEventService agentEventService;

    private static final ObjectMapper objectMapper = JsonMapper.builder().build();

    private static final String STAGING_KEY_PREFIX = "uta:staging:";
    private static final String PENDING_KEY_PREFIX = "uta:pending:";
    private static final Duration STATE_TTL = Duration.ofMinutes(30);

    private static final int MAX_COMMIT_HISTORY = 100;
    private static final DateTimeFormatter TIMESTAMP_FMT = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    // ─────────────────────────── Wallet lifecycle ────────────────────────────

    /**
     * Retrieves the user's trading wallet, creating one with $100,000 if none exists.
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
            log.info("Created unified trading wallet for user {}", userId);
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
        emitTradeEvent(userId, wallet.getId(), AgentEventType.TRADING_MODE_SWITCHED, Map.of(
                "mode", mode.name()
        ), null);
        log.info("User {} switched trading mode to {}", userId, mode);
    }

    // ───────────────────────── Phase 1: Stage ───────────────────────────────

    /**
     * Stages a unified trade operation in the user's Redis staging area.
     *
     * <p>Validates the operation's action and contract, then persists to Redis
     * with a 30-minute TTL.
     *
     * @param userId the user's UUID
     * @param op     the unified trade operation to stage
     * @return confirmation message with staging area count
     */
    public String stage(UUID userId, UnifiedTradeOperation op) {
        validateOperation(op);
        TradeWallet wallet = getOrCreateWallet(userId);

        List<UnifiedTradeOperation> staging = getRedisStaging(userId);
        staging.add(op);
        saveRedisStaging(userId, staging);

        int count = staging.size();
        String detail = formatOperationSummary(op);
        emitTradeEvent(userId, wallet.getId(), AgentEventType.TRADE_OPERATION_STAGED, Map.of(
                "action", op.action().toUpperCase().trim(),
                "ticker", op.engineSymbol(),
                "contract", op.contract().displayName(),
                "stagedCount", count
        ), null);
        log.info("User {} staged UTA operation: {} ({} total staged)", userId, detail, count);
        return String.format("Staged: %s (%d operation%s staged)", detail, count, count == 1 ? "" : "s");
    }

    /**
     * Returns the current staging area for a user.
     *
     * @param userId the user's UUID
     * @return list of staged operations, empty if none
     */
    public List<UnifiedTradeOperation> getStagingArea(UUID userId) {
        return getRedisStaging(userId);
    }

    /**
     * Clears the staging area for a user.
     *
     * @param userId the user's UUID
     */
    public void clearStagingArea(UUID userId) {
        clearRedisStaging(userId);
    }

    // ───────────────────────── Phase 2: Commit ──────────────────────────────

    /**
     * Commits the staged operations with a rationale message.
     *
     * <p>Seals staged operations with a SHA-256 hash but does NOT execute them.
     * Call {@link #execute(UUID)} to finalise.
     *
     * @param userId  the user's UUID
     * @param message the commit message explaining the trading rationale
     * @return confirmation with commit hash and operation count
     */
    public String commit(UUID userId, String message) {
        List<UnifiedTradeOperation> staged = getRedisStaging(userId);
        if (staged == null || staged.isEmpty()) {
            return "Error: Nothing to commit. Stage orders first with stageTradeOrder.";
        }
        if (message == null || message.isBlank()) {
            return "Error: Commit message is required. Explain your trading rationale.";
        }
        TradeWallet wallet = getOrCreateWallet(userId);

        // Generate commit hash
        String timestamp = LocalDateTime.now().format(TIMESTAMP_FMT);
        String hashInput = message + "|" + staged.toString() + "|" + timestamp;
        String hash = HashUtils.sha256(hashInput);

        // Build commit metadata (not yet persisted — pending until execute)
        List<Map<String, Object>> operationMaps = staged.stream()
                .map(this::operationToMap)
                .toList();

        Map<String, Object> commitData = new LinkedHashMap<>();
        commitData.put("hash", hash);
        commitData.put("message", message);
        commitData.put("timestamp", timestamp);
        commitData.put("operations", operationMaps);

        saveRedisPendingCommit(userId, commitData);
        emitTradeEvent(userId, wallet.getId(), AgentEventType.TRADE_COMMIT_CREATED, Map.of(
                "hash", hash,
                "operationCount", staged.size(),
                "messageLength", message.length()
        ), "trade-commit-created:" + hash);

        // Clear staging after successful commit
        clearRedisStaging(userId);

        int opCount = staged.size();
        log.info("User {} committed: {} -- {} ({} operations)", userId, hash, message, opCount);
        return String.format("Committed: %s -- %s (%d operation%s). Call executeTrade to finalize.",
                hash, message, opCount, opCount == 1 ? "" : "s");
    }

    // ───────────────────────── Phase 3: Execute ─────────────────────────────

    /**
     * Executes the pending commit by resolving the appropriate broker via
     * {@link BrokerRegistry}.
     *
     * <p>For {@link PaperBroker}, the engine's in-memory state is synchronised
     * from and back to the wallet's persisted JSONB columns. For live brokers,
     * orders are placed directly without wallet state sync.
     *
     * @param userId the user's UUID
     * @return formatted execution report
     */
    @Transactional
    public String execute(UUID userId) {
        Map<String, Object> commitData = getRedisPendingCommit(userId);
        if (commitData == null) {
            return "Error: No pending commit. Stage orders and commit first.";
        }
        try {
            TradeWallet wallet = getOrCreateWallet(userId);
            String commitHash = String.valueOf(commitData.get("hash"));
            boolean alreadyExecuted = wallet.getCommitHistory().stream()
                    .anyMatch(entry -> commitHash.equals(entry.get("hash")));
            if (alreadyExecuted) {
                clearRedisPendingCommit(userId);
                clearRedisStaging(userId);
                log.warn("Commit {} already executed for user {}. Cleared stale pending state.", commitHash, userId);
                return String.format("Commit %s already executed previously. Cleared stale pending state.", commitHash);
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> operations = (List<Map<String, Object>>) commitData.get("operations");

            List<Map<String, Object>> results = new ArrayList<>();
            StringBuilder report = new StringBuilder();
            report.append("=== Execution Report ===\n");

            // We track the broker display name for the report header
            String brokerName = "unknown";

            // In PAPER mode, create one PaperBroker for the entire commit to avoid
            // re-instantiating the engine per operation and preserve cash/position state.
            IBroker sharedPaperBroker = null;
            if (wallet.getTradingMode() == TradingMode.PAPER) {
                sharedPaperBroker = brokerRegistry.resolve(
                        Contract.stock("_INIT"), TradingMode.PAPER, wallet.getCashBalance());
                if (sharedPaperBroker instanceof PaperBroker pb) {
                    pb.engine().setCash(wallet.getCashBalance());
                    pb.engine().setPositions(wallet.getPositions());
                }
            }

            for (Map<String, Object> op : operations) {
                String action = (String) op.get("action");
                String ticker = (String) op.get("ticker");
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("action", action);
                result.put("ticker", ticker);

                try {
                    // Reconstruct Contract from the persisted operation map
                    Contract contract = reconstructContract(op);

                    // In PAPER mode, reuse the shared broker; in LIVE mode, resolve per-contract
                    IBroker broker = (sharedPaperBroker != null)
                            ? sharedPaperBroker
                            : brokerRegistry.resolve(contract, wallet.getTradingMode(), wallet.getCashBalance());
                    brokerName = broker.displayName();

                    OrderRequest orderRequest = toOrderRequest(op, contract);
                    OrderResult orderResult = broker.placeOrder(contract, orderRequest);

                    // For PaperBroker: sync engine state back to wallet after execution
                    if (broker instanceof PaperBroker paperBroker) {
                        wallet.setCashBalance(paperBroker.engine().getCash());
                        wallet.setPositions(paperBroker.engine().getPositionMaps());
                    }

                    result.put("success", orderResult.success());
                    result.put("broker", broker.brokerId());
                    if (orderResult.success()) {
                        result.put("filledPrice", orderResult.filledPrice());
                        result.put("shares", orderResult.filledQty());
                        if ("sell".equalsIgnoreCase(orderRequest.side())) {
                            BigDecimal proceeds = orderResult.filledQty()
                                    .multiply(orderResult.filledPrice())
                                    .setScale(2, RoundingMode.HALF_UP);
                            result.put("proceeds", proceeds);
                            report.append(String.format("  %s %s shares of %s @ $%s = $%s [%s]\n",
                                    action, orderResult.filledQty().toPlainString(), ticker,
                                    orderResult.filledPrice().toPlainString(), proceeds.toPlainString(),
                                    broker.brokerId()));
                        } else {
                            BigDecimal cost = orderResult.filledQty()
                                    .multiply(orderResult.filledPrice())
                                    .setScale(2, RoundingMode.HALF_UP);
                            result.put("cost", cost);
                            report.append(String.format("  %s %s shares of %s @ $%s = $%s [%s]\n",
                                    action, orderResult.filledQty().toPlainString(), ticker,
                                    orderResult.filledPrice().toPlainString(), cost.toPlainString(),
                                    broker.brokerId()));
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

            // Insert header with broker info after collecting broker name
            report.insert("=== Execution Report ===\n".length(),
                    String.format("Broker: %s\nCommit: %s -- %s\n\n",
                            brokerName, commitData.get("hash"), commitData.get("message")));

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

            long successCount = results.stream()
                    .filter(r -> Boolean.TRUE.equals(r.get("success")))
                    .count();
            long failCount = results.size() - successCount;
            emitTradeEvent(userId, wallet.getId(), AgentEventType.TRADE_COMMIT_EXECUTED, Map.of(
                    "hash", commitHash,
                    "broker", brokerName,
                    "operationCount", results.size(),
                    "successCount", successCount,
                    "failureCount", failCount
            ), "trade-commit-executed:" + commitHash);

            log.info("User {} executed commit {} via {}: {} operations",
                    userId, commitData.get("hash"), brokerName, results.size());
            clearRedisPendingCommit(userId);
            clearRedisStaging(userId);
            return report.toString();
        } catch (RuntimeException e) {
            log.error("Failed to execute pending commit for user {}. Pending commit retained for retry.", userId, e);
            throw e;
        }
    }

    // ───────────────────────── Query methods ─────────────────────────────────

    /**
     * Returns a formatted summary of the wallet's current state including
     * cash balance, positions with P/L, trading mode, and broker info.
     *
     * @param userId the user's UUID
     * @return formatted wallet status string
     */
    @Transactional
    public String getWalletStatus(UUID userId) {
        TradeWallet wallet = getOrCreateWallet(userId);

        List<IBroker> brokers = brokerRegistry.listAvailableBrokers(
                wallet.getTradingMode(), wallet.getCashBalance());

        StringBuilder sb = new StringBuilder();
        sb.append("=== Unified Trading Wallet ===\n");
        sb.append(String.format("Mode:            %s\n", wallet.getTradingMode()));
        sb.append(String.format("Initial Capital: $%s\n", wallet.getInitialCapital().toPlainString()));
        sb.append(String.format("Cash Balance:    $%s\n", wallet.getCashBalance().toPlainString()));
        sb.append(String.format("Brokers:         %s\n",
                brokers.stream().map(IBroker::displayName).toList()));
        sb.append("\n--- Positions ---\n");

        BigDecimal totalPositionValue = BigDecimal.ZERO;

        if (wallet.getPositions().isEmpty()) {
            sb.append("  (no open positions)\n");
        } else {
            boolean walletDirty = false;
            for (Map<String, Object> pos : wallet.getPositions()) {
                String ticker = (String) pos.get("ticker");
                BigDecimal shares = NumberUtils.toBigDecimal(pos.get("shares"));
                BigDecimal avgCost = NumberUtils.toBigDecimal(pos.get("avgCost"));
                BigDecimal currentPrice;
                try {
                    Map<String, Object> quote = marketDataService.getQuote(ticker);
                    Object closePrice = quote.get("close");
                    currentPrice = closePrice != null
                            ? NumberUtils.toBigDecimal(closePrice) : avgCost;
                    pos.put("currentPrice", currentPrice);
                    walletDirty = true;
                } catch (Exception e) {
                    currentPrice = pos.containsKey("currentPrice")
                            ? NumberUtils.toBigDecimal(pos.get("currentPrice"))
                            : avgCost;
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
            if (walletDirty) {
                walletRepository.save(wallet);
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

        return sb.toString();
    }

    /**
     * Returns the last N commits from the wallet's history.
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
            List<Map<String, Object>> resultList = (List<Map<String, Object>>) entry.get("results");
            if (resultList != null) {
                sb.append("Results:\n");
                for (Map<String, Object> res : resultList) {
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

    // ───────────────────────── Asset search ──────────────────────────────────

    /**
     * Searches all available brokers for tradable contracts matching the query.
     *
     * @param userId the user's UUID
     * @param query  search string (ticker, name, etc.)
     * @return formatted search results aggregated across brokers
     */
    public String searchAssets(UUID userId, String query) {
        TradeWallet wallet = getOrCreateWallet(userId);
        List<IBroker> brokers = brokerRegistry.listAvailableBrokers(
                wallet.getTradingMode(), wallet.getCashBalance());

        StringBuilder sb = new StringBuilder();
        sb.append(String.format("=== Asset Search: \"%s\" ===\n\n", query));

        int totalResults = 0;
        for (IBroker broker : brokers) {
            try {
                List<Contract> contracts = broker.searchContracts(query);
                if (!contracts.isEmpty()) {
                    sb.append(String.format("[%s]\n", broker.displayName()));
                    for (Contract c : contracts) {
                        sb.append(String.format("  %s — %s\n", c.toEngineSymbol(), c.displayName()));
                        totalResults++;
                    }
                    sb.append("\n");
                }
            } catch (Exception e) {
                log.warn("Search failed for broker {}: {}", broker.brokerId(), e.getMessage());
                sb.append(String.format("[%s] — search unavailable: %s\n\n",
                        broker.displayName(), e.getMessage()));
            }
        }

        if (totalResults == 0) {
            sb.append("No matching assets found.\n");
        } else {
            sb.append(String.format("Total: %d result%s\n", totalResults, totalResults == 1 ? "" : "s"));
        }

        return sb.toString();
    }

    // ───────────────────────── Redis state helpers ────────────────────────────

    private List<UnifiedTradeOperation> getRedisStaging(UUID userId) {
        try {
            String json = redisTemplate.opsForValue().get(STAGING_KEY_PREFIX + userId);
            if (json == null) return new ArrayList<>();
            return objectMapper.readValue(json, new TypeReference<List<UnifiedTradeOperation>>() {});
        } catch (Exception e) {
            log.error("Failed to read staging from Redis for user {}", userId, e);
            throw new IllegalStateException("Failed to read staged operations from state store. Please retry.", e);
        }
    }

    private void saveRedisStaging(UUID userId, List<UnifiedTradeOperation> ops) {
        try {
            String json = objectMapper.writeValueAsString(ops);
            redisTemplate.opsForValue().set(STAGING_KEY_PREFIX + userId, json, STATE_TTL);
        } catch (Exception e) {
            log.error("Failed to save staging to Redis for user {}", userId, e);
            throw new IllegalStateException("Failed to persist staged operations. Please retry.", e);
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
            log.error("Failed to read pending commit from Redis for user {}", userId, e);
            throw new IllegalStateException("Failed to read pending commit from state store. Please retry.", e);
        }
    }

    private void saveRedisPendingCommit(UUID userId, Map<String, Object> commitData) {
        try {
            String json = objectMapper.writeValueAsString(commitData);
            redisTemplate.opsForValue().set(PENDING_KEY_PREFIX + userId, json, STATE_TTL);
        } catch (Exception e) {
            log.error("Failed to save pending commit to Redis for user {}", userId, e);
            throw new IllegalStateException("Failed to persist pending commit. Please retry.", e);
        }
    }

    private void clearRedisPendingCommit(UUID userId) {
        redisTemplate.delete(PENDING_KEY_PREFIX + userId);
    }

    // ───────────────────────── Internal helpers ──────────────────────────────

    private void validateOperation(UnifiedTradeOperation op) {
        if (op.action() == null || op.action().isBlank()) {
            throw new IllegalArgumentException("Trade action is required (BUY, SELL, or CLOSE)");
        }
        String action = op.action().toUpperCase().trim();
        if (!action.equals("BUY") && !action.equals("SELL") && !action.equals("CLOSE")) {
            throw new IllegalArgumentException("Invalid action: " + action + ". Must be BUY, SELL, or CLOSE");
        }
        // Contracts handle their own symbol validation, just verify non-null
        if (op.contract() == null) {
            throw new IllegalArgumentException("Contract must not be null");
        }
        if (!action.equals("CLOSE")) {
            if ((op.qty() == null || op.qty().compareTo(BigDecimal.ZERO) <= 0)
                    && (op.notional() == null || op.notional().compareTo(BigDecimal.ZERO) <= 0)) {
                throw new IllegalArgumentException("Either qty or notional must be positive for " + action);
            }
        }
    }

    /**
     * Converts a {@link UnifiedTradeOperation} to a map for JSON serialization in commit data.
     */
    private Map<String, Object> operationToMap(UnifiedTradeOperation op) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("action", op.action().toUpperCase().trim());
        map.put("ticker", op.engineSymbol());
        // Persist contract fields for reconstruction during execute
        map.put("contractSymbol", op.contract().symbol());
        map.put("contractSecType", op.contract().secType().name());
        map.put("contractExchange", op.contract().exchange());
        map.put("contractCurrency", op.contract().currency());
        if (op.qty() != null) map.put("shares", op.qty());
        if (op.notional() != null) map.put("amount", op.notional());
        if (op.price() != null) map.put("price", op.price());
        return map;
    }

    /**
     * Reconstructs a {@link Contract} from a persisted operation map.
     */
    private Contract reconstructContract(Map<String, Object> op) {
        String contractSymbol = (String) op.get("contractSymbol");
        String contractSecType = (String) op.get("contractSecType");

        if (contractSymbol != null && contractSecType != null) {
            return new Contract(
                    contractSymbol,
                    SecurityType.valueOf(contractSecType),
                    (String) op.get("contractExchange"),
                    (String) op.get("contractCurrency"),
                    null, null, null, null);
        }
        // Fallback: parse from ticker string
        String ticker = (String) op.get("ticker");
        return Contract.fromString(ticker);
    }

    /**
     * Converts a persisted operation map into an {@link OrderRequest}.
     */
    private OrderRequest toOrderRequest(Map<String, Object> op, Contract contract) {
        String action = (String) op.get("action");
        String side = "CLOSE".equals(action) || "SELL".equals(action) ? "sell" : "buy";
        BigDecimal shares = op.containsKey("shares") ? NumberUtils.toBigDecimal(op.get("shares")) : null;
        BigDecimal amount = op.containsKey("amount") ? NumberUtils.toBigDecimal(op.get("amount")) : null;
        BigDecimal price = op.containsKey("price") ? NumberUtils.toBigDecimal(op.get("price")) : null;
        String type = price != null ? "limit" : "market";

        return new OrderRequest(contract.toEngineSymbol(), side, type, shares, amount, price, null, "day",
                "CLOSE".equals(action));
    }

    private String formatOperationSummary(UnifiedTradeOperation op) {
        String action = op.action().toUpperCase().trim();
        String display = op.contract().displayName();
        if (action.equals("CLOSE")) {
            return "CLOSE all of " + display;
        }
        if (op.qty() != null && op.qty().compareTo(BigDecimal.ZERO) > 0) {
            return String.format("%s %s of %s", action, op.qty().toPlainString(), display);
        }
        if (op.notional() != null && op.notional().compareTo(BigDecimal.ZERO) > 0) {
            return String.format("%s $%s of %s", action, op.notional().toPlainString(), display);
        }
        return action + " " + display;
    }

    private Map<String, Object> buildWalletSnapshot(TradeWallet wallet) {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("cashBalance", wallet.getCashBalance());
        snapshot.put("positions", new ArrayList<>(wallet.getPositions()));
        return snapshot;
    }

    private void emitTradeEvent(UUID userId,
                                UUID walletId,
                                AgentEventType eventType,
                                Map<String, Object> payload,
                                String idempotencyKey) {
        try {
            agentEventService.append(
                    userId,
                    AgentEventAggregateType.TRADE_WALLET,
                    walletId,
                    eventType,
                    payload,
                    idempotencyKey
            );
        } catch (Exception e) {
            log.warn("Failed to append trading event {} for user {}: {}", eventType, userId, e.getMessage());
        }
    }
}
