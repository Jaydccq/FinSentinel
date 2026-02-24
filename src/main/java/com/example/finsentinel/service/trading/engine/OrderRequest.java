package com.example.finsentinel.service.trading.engine;

import java.math.BigDecimal;

public record OrderRequest(
    String symbol,
    String side,        // "buy" or "sell"
    String type,        // "market", "limit", "stop", "stop_limit"
    BigDecimal qty,     // number of shares/coins (nullable if notional set)
    BigDecimal notional,// dollar amount (nullable if qty set)
    BigDecimal price,   // limit price (nullable for market orders)
    BigDecimal stopPrice, // stop trigger price (nullable)
    String timeInForce, // "day", "gtc", "ioc", "fok" (nullable, default "day")
    boolean reduceOnly  // crypto: close-only flag
) {}
