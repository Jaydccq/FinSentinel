package com.example.finsentinel.service.trading.uta;

import com.example.finsentinel.service.trading.engine.AccountInfo;
import com.example.finsentinel.service.trading.engine.OrderRequest;
import com.example.finsentinel.service.trading.engine.OrderResult;
import com.example.finsentinel.service.trading.engine.PaperTradingEngine;
import com.example.finsentinel.service.trading.engine.PositionInfo;

import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * IBroker adapter for the in-memory paper trading engine.
 * Supports all security types since paper trading simulates everything.
 * Not a Spring bean — created by BrokerRegistry.
 */
public class PaperBroker implements IBroker {

    private final PaperTradingEngine engine;

    public PaperBroker(PaperTradingEngine engine) {
        this.engine = Objects.requireNonNull(engine, "PaperTradingEngine must not be null");
    }

    @Override
    public String brokerId() {
        return "paper";
    }

    @Override
    public String displayName() {
        return "Paper Trading (Simulated)";
    }

    @Override
    public Set<SecurityType> supportedSecurityTypes() {
        return EnumSet.allOf(SecurityType.class);
    }

    @Override
    public Set<BrokerCapability> capabilities() {
        return EnumSet.of(BrokerCapability.SPOT_TRADING, BrokerCapability.MARKET_DATA);
    }

    @Override
    public OrderResult placeOrder(Contract contract, OrderRequest request) {
        var nativeRequest = new OrderRequest(
                contract.toEngineSymbol(), request.side(), request.type(),
                request.qty(), request.notional(), request.price(),
                request.stopPrice(), request.timeInForce(), request.reduceOnly());
        return engine.placeOrder(nativeRequest);
    }

    @Override
    public List<PositionInfo> getPositions() {
        return engine.getPositions();
    }

    @Override
    public List<OrderResult> getOrders() {
        return engine.getOrders();
    }

    @Override
    public AccountInfo getAccount() {
        return engine.getAccount();
    }

    @Override
    public boolean cancelOrder(String orderId) {
        return engine.cancelOrder(orderId);
    }

    /** Exposes the underlying engine for wallet state sync. */
    public PaperTradingEngine engine() {
        return engine;
    }
}
