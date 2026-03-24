package com.example.finsentinel.service.trading.uta;

/**
 * Capabilities a broker can declare support for.
 * Used by BrokerRegistry to route operations to the correct broker.
 */
public enum BrokerCapability {
    SPOT_TRADING,
    MARGIN_TRADING,
    PERPETUAL_SWAP,
    FUTURES,
    OPTIONS,
    MARKET_DATA,
    ORDER_MANAGEMENT,
    SHORT_SELLING
}
