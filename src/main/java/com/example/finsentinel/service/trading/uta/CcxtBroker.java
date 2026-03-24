package com.example.finsentinel.service.trading.uta;

import com.example.finsentinel.service.trading.engine.AccountInfo;
import com.example.finsentinel.service.trading.engine.CcxtTradingEngine;
import com.example.finsentinel.service.trading.engine.OrderRequest;
import com.example.finsentinel.service.trading.engine.OrderResult;
import com.example.finsentinel.service.trading.engine.PositionInfo;

import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * IBroker adapter for CCXT (XChange) crypto exchanges.
 * Supports CRYPTO security type only.
 * Not a Spring bean — created by BrokerRegistry.
 */
public class CcxtBroker implements IBroker {

    private final CcxtTradingEngine engine;

    public CcxtBroker(CcxtTradingEngine engine) {
        this.engine = Objects.requireNonNull(engine, "CcxtTradingEngine must not be null");
    }

    @Override
    public String brokerId() {
        return "ccxt-" + engine.engineName();
    }

    @Override
    public String displayName() {
        return "CCXT (" + engine.engineName() + ")";
    }

    @Override
    public Set<SecurityType> supportedSecurityTypes() {
        return EnumSet.of(SecurityType.CRYPTO);
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
}
