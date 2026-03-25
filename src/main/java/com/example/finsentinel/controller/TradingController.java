package com.example.finsentinel.controller;

import com.example.finsentinel.dto.trading.*;
import com.example.finsentinel.model.TradeOperation;
import com.example.finsentinel.model.TradeWallet;
import com.example.finsentinel.model.enums.TradingMode;
import com.example.finsentinel.security.UserPrincipal;
import com.example.finsentinel.service.trading.PaperTradingService;
import com.example.finsentinel.service.trading.engine.MarketClock;
import com.example.finsentinel.service.trading.engine.TradingEngine;
import com.example.finsentinel.service.trading.uta.Contract;
import com.example.finsentinel.service.trading.uta.UnifiedTradeOperation;
import com.example.finsentinel.service.trading.uta.UnifiedTradingService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.UUID;

/**
 * REST controller exposing the paper trading subsystem via HTTP endpoints.
 *
 * <p>Delegates to {@link PaperTradingService} for the git-like three-phase
 * trading workflow (stage, commit, execute) and query operations.
 *
 * <p>v2 endpoints under {@code /api/trading/v2/} delegate to the new
 * {@link UnifiedTradingService} which supports Contract-based asset identification
 * and multi-broker routing via the UTA system.
 *
 * <p>This class belongs to the controller layer in FinSentinel.
 */
@RestController
@RequestMapping("/api/trading")
@RequiredArgsConstructor
public class TradingController {

    private final PaperTradingService paperTradingService;
    private final UnifiedTradingService unifiedTradingService;

    // ───────────────────────── Phase 1: Stage ─────────────────────────────

    /**
     * Stages a trade operation in the user's staging area.
     *
     * @param request   the stage request containing action, ticker, shares/amount
     * @param principal the authenticated user
     * @return confirmation message with staging area count
     */
    @PostMapping("/stage")
    public ResponseEntity<TradingResponse> stage(
            @Valid @RequestBody StageRequest request,
            @AuthenticationPrincipal UserPrincipal principal) {

        TradeOperation operation = new TradeOperation(
                request.action(),
                request.ticker(),
                request.shares(),
                request.amount(),
                null // market order by default via REST
        );

        String result = paperTradingService.stage(principal.getUserId(), operation);
        return ResponseEntity.ok(new TradingResponse(result));
    }

    /**
     * Returns the list of currently staged trade operations.
     *
     * @param principal the authenticated user
     * @return list of staged operations
     */
    @GetMapping("/staged")
    public ResponseEntity<List<StagedOperationResponse>> getStaged(
            @AuthenticationPrincipal UserPrincipal principal) {

        List<TradeOperation> staged = paperTradingService.getStagingArea(principal.getUserId());
        List<StagedOperationResponse> response = staged.stream()
                .map(op -> new StagedOperationResponse(
                        op.action(),
                        op.ticker(),
                        op.shares(),
                        op.amount(),
                        op.price()
                ))
                .toList();

        return ResponseEntity.ok(response);
    }

    // ───────────────────────── Phase 2: Commit ────────────────────────────

    /**
     * Commits staged operations with a rationale message.
     *
     * @param request   the commit request containing the rationale message
     * @param principal the authenticated user
     * @return confirmation with commit hash and operation count
     */
    @PostMapping("/commit")
    public ResponseEntity<TradingResponse> commit(
            @Valid @RequestBody CommitRequest request,
            @AuthenticationPrincipal UserPrincipal principal) {

        String result = paperTradingService.commit(principal.getUserId(), request.message());
        return ResponseEntity.ok(new TradingResponse(result));
    }

    // ───────────────────────── Phase 3: Execute ───────────────────────────

    /**
     * Executes the pending commit against the trading engine.
     *
     * @param principal the authenticated user
     * @return execution report with results for each operation
     */
    @PostMapping("/execute")
    public ResponseEntity<TradingResponse> execute(
            @AuthenticationPrincipal UserPrincipal principal) {

        String result = paperTradingService.execute(principal.getUserId());
        return ResponseEntity.ok(new TradingResponse(result));
    }

    // ───────────────────────── Query endpoints ────────────────────────────

    /**
     * Returns the wallet status including cash, positions, total value, and return percentage.
     *
     * @param principal the authenticated user
     * @return wallet state with computed totals
     */
    @GetMapping("/wallet")
    public ResponseEntity<WalletResponse> getWallet(
            @AuthenticationPrincipal UserPrincipal principal) {

        UUID userId = principal.getUserId();
        TradeWallet wallet = paperTradingService.getOrCreateWallet(userId);

        BigDecimal positionValue = wallet.getPositions().stream()
                .map(pos -> {
                    BigDecimal shares = toBigDecimal(pos.get("shares"));
                    BigDecimal price = pos.containsKey("currentPrice")
                            ? toBigDecimal(pos.get("currentPrice"))
                            : toBigDecimal(pos.get("avgCost"));
                    return shares.multiply(price).setScale(2, RoundingMode.HALF_UP);
                })
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        BigDecimal totalValue = wallet.getCashBalance().add(positionValue);
        BigDecimal returnPercent = wallet.getInitialCapital().compareTo(BigDecimal.ZERO) > 0
                ? totalValue.subtract(wallet.getInitialCapital())
                        .divide(wallet.getInitialCapital(), 4, RoundingMode.HALF_UP)
                        .multiply(new BigDecimal("100"))
                : BigDecimal.ZERO;

        WalletResponse response = new WalletResponse(
                wallet.getInitialCapital(),
                wallet.getCashBalance(),
                wallet.getPositions(),
                totalValue,
                returnPercent,
                wallet.getTradingMode()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Returns the trade commit history (most recent first).
     *
     * @param limit     maximum number of commits to return (default 10, max 50)
     * @param principal the authenticated user
     * @return formatted commit log
     */
    @GetMapping("/history")
    public ResponseEntity<TradingResponse> getHistory(
            @RequestParam(defaultValue = "10") int limit,
            @AuthenticationPrincipal UserPrincipal principal) {

        int clampedLimit = Math.min(Math.max(limit, 1), 50);
        String result = paperTradingService.getCommitLog(principal.getUserId(), clampedLimit);
        return ResponseEntity.ok(new TradingResponse(result));
    }

    // ───────────────────────── Simulation ─────────────────────────────────

    /**
     * Simulates the impact of a hypothetical price change on a position.
     * Does not modify any positions.
     *
     * @param request   the simulation request with ticker and change percent
     * @param principal the authenticated user
     * @return what-if analysis report
     */
    @PostMapping("/simulate")
    public ResponseEntity<TradingResponse> simulate(
            @Valid @RequestBody SimulateRequest request,
            @AuthenticationPrincipal UserPrincipal principal) {

        String result = paperTradingService.simulatePriceChange(
                principal.getUserId(),
                request.ticker(),
                request.changePercent()
        );
        return ResponseEntity.ok(new TradingResponse(result));
    }

    // ───────────────────────── Market hours ───────────────────────────────

    /**
     * Returns the current market open/close status from the user's trading engine.
     *
     * @param principal the authenticated user
     * @return market clock status
     */
    @GetMapping("/market-hours")
    public ResponseEntity<MarketHoursResponse> getMarketHours(
            @AuthenticationPrincipal UserPrincipal principal) {

        TradingEngine engine = paperTradingService.getEngineForUser(principal.getUserId());
        MarketClock clock = engine.getMarketClock();

        MarketHoursResponse response = new MarketHoursResponse(
                clock.isOpen(),
                clock.nextOpen(),
                clock.nextClose(),
                clock.timestamp()
        );

        return ResponseEntity.ok(response);
    }

    // ───────────────────────── Mode switching ─────────────────────────────

    /**
     * Switches the trading mode for the user's wallet (PAPER or LIVE).
     *
     * @param request   the mode switch request
     * @param principal the authenticated user
     * @return confirmation of mode switch
     */
    @PutMapping("/mode")
    public ResponseEntity<TradingResponse> switchMode(
            @Valid @RequestBody SwitchModeRequest request,
            @AuthenticationPrincipal UserPrincipal principal) {

        paperTradingService.switchMode(principal.getUserId(), request.mode());
        return ResponseEntity.ok(new TradingResponse(
                "Trading mode switched to " + request.mode().name()
        ));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  v2 endpoints — Unified Trading Account (UTA)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Stages a unified trade operation using Contract-based asset identification.
     *
     * @param request   the v2 stage request with action, symbol, qty/amount/price
     * @param principal the authenticated user
     * @return confirmation message with staging area count
     */
    @PostMapping("/v2/stage")
    public ResponseEntity<TradingResponse> v2Stage(
            @Valid @RequestBody UnifiedStageRequest request,
            @AuthenticationPrincipal UserPrincipal principal) {

        Contract contract = Contract.fromString(request.symbol());
        BigDecimal qty;
        BigDecimal amount;
        BigDecimal price;
        try {
            qty = request.qty() != null && !request.qty().isBlank() ? new BigDecimal(request.qty()) : null;
            amount = request.amount() != null && !request.amount().isBlank() ? new BigDecimal(request.amount()) : null;
            price = request.price() != null && !request.price().isBlank() ? new BigDecimal(request.price()) : null;
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest()
                    .body(new TradingResponse("Invalid numeric value: " + e.getMessage()));
        }
        UnifiedTradeOperation operation = new UnifiedTradeOperation(
                request.action(), contract, qty, amount, price);

        String result = unifiedTradingService.stage(principal.getUserId(), operation);
        return ResponseEntity.ok(new TradingResponse(result));
    }

    /**
     * Commits staged unified trade operations with a rationale message.
     *
     * @param request   the commit request containing the rationale message
     * @param principal the authenticated user
     * @return confirmation with commit hash and operation count
     */
    @PostMapping("/v2/commit")
    public ResponseEntity<TradingResponse> v2Commit(
            @Valid @RequestBody CommitRequest request,
            @AuthenticationPrincipal UserPrincipal principal) {

        String result = unifiedTradingService.commit(principal.getUserId(), request.message());
        return ResponseEntity.ok(new TradingResponse(result));
    }

    /**
     * Executes the pending commit via the unified broker registry.
     *
     * @param principal the authenticated user
     * @return execution report with results for each operation
     */
    @PostMapping("/v2/execute")
    public ResponseEntity<TradingResponse> v2Execute(
            @AuthenticationPrincipal UserPrincipal principal) {

        String result = unifiedTradingService.execute(principal.getUserId());
        return ResponseEntity.ok(new TradingResponse(result));
    }

    /**
     * Returns the unified wallet status including cash, positions, brokers, and return percentage.
     *
     * @param principal the authenticated user
     * @return formatted wallet status
     */
    @GetMapping("/v2/wallet")
    public ResponseEntity<TradingResponse> v2GetWallet(
            @AuthenticationPrincipal UserPrincipal principal) {

        String result = unifiedTradingService.getWalletStatus(principal.getUserId());
        return ResponseEntity.ok(new TradingResponse(result));
    }

    /**
     * Returns the trade commit history via the unified service.
     *
     * @param limit     maximum number of commits to return (default 10, max 50)
     * @param principal the authenticated user
     * @return formatted commit log
     */
    @GetMapping("/v2/history")
    public ResponseEntity<TradingResponse> v2GetHistory(
            @RequestParam(defaultValue = "10") int limit,
            @AuthenticationPrincipal UserPrincipal principal) {

        int clampedLimit = Math.min(Math.max(limit, 1), 50);
        String result = unifiedTradingService.getCommitLog(principal.getUserId(), clampedLimit);
        return ResponseEntity.ok(new TradingResponse(result));
    }

    /**
     * Returns the currently staged unified trade operations.
     *
     * @param principal the authenticated user
     * @return list of staged operations as formatted text
     */
    @GetMapping("/v2/staged")
    public ResponseEntity<TradingResponse> v2GetStaged(
            @AuthenticationPrincipal UserPrincipal principal) {

        List<UnifiedTradeOperation> staged = unifiedTradingService.getStagingArea(principal.getUserId());
        if (staged.isEmpty()) {
            return ResponseEntity.ok(new TradingResponse("No staged orders."));
        }
        StringBuilder sb = new StringBuilder();
        sb.append("=== Staged Orders (UTA) ===\n");
        for (int i = 0; i < staged.size(); i++) {
            UnifiedTradeOperation op = staged.get(i);
            sb.append(String.format("  %d. %s %s", i + 1, op.action(), op.contract().displayName()));
            if (op.qty() != null) sb.append(String.format(" (qty: %s)", op.qty().toPlainString()));
            if (op.notional() != null) sb.append(String.format(" ($%s)", op.notional().toPlainString()));
            if (op.price() != null) sb.append(String.format(" @ %s", op.price().toPlainString()));
            sb.append("\n");
        }
        sb.append(String.format("\n%d order%s staged.", staged.size(), staged.size() == 1 ? "" : "s"));
        return ResponseEntity.ok(new TradingResponse(sb.toString()));
    }

    /**
     * Searches all available brokers for tradable contracts matching the query.
     *
     * @param q         the search query (ticker, name, etc.)
     * @param principal the authenticated user
     * @return aggregated search results across brokers
     */
    @GetMapping("/v2/search")
    public ResponseEntity<TradingResponse> v2SearchAssets(
            @RequestParam String q,
            @AuthenticationPrincipal UserPrincipal principal) {

        String result = unifiedTradingService.searchAssets(principal.getUserId(), q);
        return ResponseEntity.ok(new TradingResponse(result));
    }

    // ───────────────────────── Internal helpers ───────────────────────────

    private BigDecimal toBigDecimal(Object value) {
        if (value == null) return BigDecimal.ZERO;
        if (value instanceof BigDecimal bd) return bd;
        if (value instanceof Number n) return new BigDecimal(n.toString());
        return new BigDecimal(value.toString());
    }
}
