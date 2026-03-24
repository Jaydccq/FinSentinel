package com.example.finsentinel.service.trading.uta;

import com.example.finsentinel.service.trading.engine.AccountInfo;
import com.example.finsentinel.service.trading.engine.AlpacaTradingEngine;
import com.example.finsentinel.service.trading.engine.MarketClock;
import com.example.finsentinel.service.trading.engine.OrderRequest;
import com.example.finsentinel.service.trading.engine.OrderResult;
import com.example.finsentinel.service.trading.engine.PositionInfo;

import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * IBroker adapter for Alpaca US equities trading.
 * Supports STOCK security type only.
 * Not a Spring bean — created by BrokerRegistry.
 */
public class AlpacaBroker implements IBroker {

    private final AlpacaTradingEngine engine;

    public AlpacaBroker(AlpacaTradingEngine engine) {
        this.engine = Objects.requireNonNull(engine, "AlpacaTradingEngine must not be null");
    }

    @Override
    public String brokerId() {
        return "alpaca";
    }

    @Override
    public String displayName() {
        return "Alpaca (US Equities)";
    }

    @Override
    public Set<SecurityType> supportedSecurityTypes() {
        return EnumSet.of(SecurityType.STOCK);
    }

    @Override
    public Set<BrokerCapability> capabilities() {
        return EnumSet.of(
                BrokerCapability.SPOT_TRADING,
                BrokerCapability.MARKET_DATA,
                BrokerCapability.ORDER_MANAGEMENT,
                BrokerCapability.SHORT_SELLING);
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
    public List<OrderResult> syncOrders() {
        return engine.syncOrders();
    }

    @Override
    public AccountInfo getAccount() {
        return engine.getAccount();
    }

    @Override
    public boolean cancelOrder(String orderId) {
        return engine.cancelOrder(orderId);
    }

    @Override
    public MarketClock getMarketClock() {
        return engine.getMarketClock();
    }
}
