package com.example.finsentinel.service.trading.engine;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public record OrderResult(
    boolean success,
    String orderId,
    String status,       // "filled", "pending", "cancelled", "rejected"
    BigDecimal filledPrice,
    BigDecimal filledQty,
    String error,
    LocalDateTime filledAt
) {}
