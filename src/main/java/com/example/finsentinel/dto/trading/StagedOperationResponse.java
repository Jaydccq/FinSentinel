package com.example.finsentinel.dto.trading;

import java.math.BigDecimal;

/**
 * Response representing a single staged trade operation.
 *
 * @param action the trade action (BUY, SELL, or CLOSE)
 * @param ticker the stock ticker symbol
 * @param shares number of shares (may be null if amount-based)
 * @param amount dollar amount (may be null if shares-based)
 * @param price  limit price (null for market orders)
 */
public record StagedOperationResponse(
        String action,
        String ticker,
        BigDecimal shares,
        BigDecimal amount,
        BigDecimal price
) {}
