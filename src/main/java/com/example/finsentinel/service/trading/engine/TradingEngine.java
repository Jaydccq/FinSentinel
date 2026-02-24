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
}
