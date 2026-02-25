package com.example.finsentinel.service.trading.engine;

import java.util.List;

/**
 * Provider-agnostic trading engine interface (OpenAlice pattern).
 * Implementations: PaperTradingEngine (simulated), AlpacaTradingEngine (US equities),
 * CcxtTradingEngine (crypto).
 */
public interface TradingEngine {
    OrderResult placeOrder(OrderRequest request);
    List<PositionInfo> getPositions();
    List<OrderResult> getOrders();
    AccountInfo getAccount();
    boolean cancelOrder(String orderId);
    String engineName();

    /**
     * Polls the broker for the latest status of open/pending orders.
     * Returns a list of orders whose status has changed since last check.
     * Default implementation returns the full order list (no diffing).
     */
    default List<OrderResult> syncOrders() {
        return getOrders();
    }

    /**
     * Returns the current market clock (open/closed status, next open/close times).
     * Default returns an always-open clock for engines without market hours (crypto, paper).
     */
    default MarketClock getMarketClock() {
        return new MarketClock(true, null, null, java.time.Instant.now());
    }
}
