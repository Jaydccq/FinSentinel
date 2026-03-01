package com.example.finsentinel.controller;

import com.example.finsentinel.service.okx.OkxApiClient;
import com.example.finsentinel.service.okx.OkxTradingEngine;
import com.example.finsentinel.service.okx.dto.*;
import com.example.finsentinel.service.trading.engine.AccountInfo;
import com.example.finsentinel.service.trading.engine.OrderResult;
import com.example.finsentinel.service.trading.engine.PositionInfo;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Read-only REST controller exposing OKX account, position, and market data.
 *
 * <p>All endpoints are GET-only — no orders can be placed through this controller.
 * Order placement goes through the paper trading subsystem ({@link TradingController}).
 *
 * <p>Uses {@link OkxApiClient} (Spring bean) directly for simple market lookups,
 * and a lazily-initialized {@link OkxTradingEngine} wrapper for account/position
 * queries that need response mapping to generic engine records.
 *
 * <p>Only active when {@code app.trading.okx.enabled=true}.
 */
@RestController
@RequestMapping("/api/okx")
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(name = "app.trading.okx.enabled", havingValue = "true")
public class OkxController {

    private final OkxApiClient okxApiClient;
    private OkxTradingEngine engine;

    @PostConstruct
    void init() {
        this.engine = new OkxTradingEngine(okxApiClient);
        log.info("OKX read-only controller initialized");
    }

    // ── Account ─────────────────────────────────────────────────────────

    /**
     * Get OKX account summary (equity, cash, buying power, unrealized PnL).
     */
    @GetMapping("/account")
    public ResponseEntity<AccountInfo> getAccount() {
        return ResponseEntity.ok(engine.getAccount());
    }

    /**
     * Get per-currency balance details (equity, available, frozen per coin).
     */
    @GetMapping("/balance/details")
    public ResponseEntity<List<OkxAccountBalance.BalanceDetail>> getBalanceDetails() {
        return ResponseEntity.ok(engine.getBalanceDetails());
    }

    // ── Positions ───────────────────────────────────────────────────────

    /**
     * Get all open positions (spot + derivatives), mapped to generic PositionInfo.
     */
    @GetMapping("/positions")
    public ResponseEntity<List<PositionInfo>> getPositions() {
        return ResponseEntity.ok(engine.getPositions());
    }

    // ── Orders ──────────────────────────────────────────────────────────

    /**
     * Get currently pending (unfilled) orders.
     */
    @GetMapping("/orders/pending")
    public ResponseEntity<List<OrderResult>> getPendingOrders() {
        return ResponseEntity.ok(engine.getOrders());
    }

    /**
     * Get order history for an instrument type.
     *
     * @param instType instrument type: SPOT, SWAP, FUTURES, OPTION (default SPOT)
     */
    @GetMapping("/orders/history")
    public ResponseEntity<List<OkxOrder>> getOrderHistory(
            @RequestParam(defaultValue = "SPOT") String instType) {
        return ResponseEntity.ok(engine.getOrderHistory(instType));
    }

    // ── Market Data ─────────────────────────────────────────────────────

    /**
     * Get funding rate for a perpetual swap instrument.
     *
     * @param instId instrument ID (e.g. "BTC-USDT-SWAP")
     */
    @GetMapping("/funding-rate/{instId}")
    public ResponseEntity<OkxFundingRate> getFundingRate(@PathVariable String instId) {
        OkxFundingRate rate = engine.getFundingRate(instId);
        return rate != null ? ResponseEntity.ok(rate) : ResponseEntity.notFound().build();
    }

    /**
     * Get real-time ticker for any OKX instrument.
     *
     * @param instId instrument ID (e.g. "BTC-USDT", "ETH-USDT-SWAP")
     */
    @GetMapping("/ticker/{instId}")
    public ResponseEntity<OkxTicker> getTicker(@PathVariable String instId) {
        OkxResponse<OkxTicker> response = okxApiClient.getTicker(instId);
        if (response.isSuccess() && !response.data().isEmpty()) {
            return ResponseEntity.ok(response.data().getFirst());
        }
        return ResponseEntity.notFound().build();
    }
}
