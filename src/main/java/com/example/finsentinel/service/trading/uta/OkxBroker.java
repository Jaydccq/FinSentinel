package com.example.finsentinel.service.trading.uta;

import com.example.finsentinel.service.okx.OkxTradingEngine;
import com.example.finsentinel.service.trading.engine.AccountInfo;
import com.example.finsentinel.service.trading.engine.OrderRequest;
import com.example.finsentinel.service.trading.engine.OrderResult;
import com.example.finsentinel.service.trading.engine.PositionInfo;

import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * IBroker adapter for OKX crypto derivatives trading.
 * Supports CRYPTO and PERP security types.
 * Not a Spring bean — created by BrokerRegistry.
 */
public class OkxBroker implements IBroker {

    private final OkxTradingEngine engine;

    public OkxBroker(OkxTradingEngine engine) {
        this.engine = Objects.requireNonNull(engine, "OkxTradingEngine must not be null");
    }

    @Override
    public String brokerId() {
        return "okx";
    }

    @Override
    public String displayName() {
        return "OKX (Crypto Derivatives)";
    }

    @Override
    public Set<SecurityType> supportedSecurityTypes() {
        // OKX only handles perpetual swaps via UTA routing.
        // Crypto spot uses CCXT slash format (BTC/USDT) which OKX rejects —
        // spot orders should route to CcxtBroker instead.
        return EnumSet.of(SecurityType.PERP);
    }

    @Override
    public Set<BrokerCapability> capabilities() {
        return EnumSet.of(
                BrokerCapability.SPOT_TRADING,
                BrokerCapability.PERPETUAL_SWAP,
                BrokerCapability.MARGIN_TRADING,
                BrokerCapability.MARKET_DATA,
                BrokerCapability.ORDER_MANAGEMENT);
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

    /** Exposes the underlying engine for OKX-specific operations (funding rate, leverage). */
    public OkxTradingEngine engine() {
        return engine;
    }
}
