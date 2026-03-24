package com.example.finsentinel.service.trading.uta;

import com.example.finsentinel.service.trading.engine.AccountInfo;
import com.example.finsentinel.service.trading.engine.MarketClock;
import com.example.finsentinel.service.trading.engine.OrderRequest;
import com.example.finsentinel.service.trading.engine.OrderResult;
import com.example.finsentinel.service.trading.engine.PositionInfo;

import java.time.Instant;
import java.util.List;
import java.util.Set;

/**
 * Unified broker interface operating on Contracts.
 * Wraps TradingEngine with Contract-aware routing.
 * Each implementation adapts one underlying TradingEngine.
 */
public interface IBroker {

    /** Unique broker identifier (e.g., "paper", "alpaca", "okx", "ccxt-binance") */
    String brokerId();

    /** Human-readable name for AI responses */
    String displayName();

    /** Which security types this broker can handle */
    Set<SecurityType> supportedSecurityTypes();

    /** Which capabilities this broker supports */
    Set<BrokerCapability> capabilities();

    /** Check if this broker can handle the given contract */
    default boolean canHandle(Contract contract) {
        return supportedSecurityTypes().contains(contract.secType());
    }

    // --- Core trading operations (Contract-aware) ---

    OrderResult placeOrder(Contract contract, OrderRequest request);

    List<PositionInfo> getPositions();

    List<OrderResult> getOrders();

    AccountInfo getAccount();

    boolean cancelOrder(String orderId);

    // --- Extended operations ---

    default List<OrderResult> syncOrders() {
        return getOrders();
    }

    default MarketClock getMarketClock() {
        return new MarketClock(true, null, null, Instant.now());
    }

    /** Search for tradable contracts matching a query. Enables AI heuristic search. */
    default List<Contract> searchContracts(String query) {
        return List.of();
    }
}
