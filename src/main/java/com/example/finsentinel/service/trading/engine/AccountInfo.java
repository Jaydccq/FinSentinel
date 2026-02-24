package com.example.finsentinel.service.trading.engine;

import java.math.BigDecimal;

public record AccountInfo(
    BigDecimal cash,
    BigDecimal portfolioValue,
    BigDecimal equity,
    BigDecimal buyingPower,
    BigDecimal unrealizedPnL,
    BigDecimal realizedPnL
) {}
