package com.example.finsentinel.service.trading.engine;

import java.math.BigDecimal;

public record PositionInfo(
    String symbol,
    String side,           // "long" or "short"
    BigDecimal qty,
    BigDecimal avgEntryPrice,
    BigDecimal currentPrice,
    BigDecimal marketValue,
    BigDecimal unrealizedPnL,
    BigDecimal costBasis
) {}
