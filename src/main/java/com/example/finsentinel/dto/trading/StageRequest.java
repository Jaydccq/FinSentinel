package com.example.finsentinel.dto.trading;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

import java.math.BigDecimal;

/**
 * Request body for staging a trade operation.
 *
 * @param action the trade action: BUY, SELL, or CLOSE
 * @param ticker the stock ticker symbol (e.g., "AAPL")
 * @param shares number of shares to trade (alternative to amount)
 * @param amount dollar amount to trade (alternative to shares)
 */
public record StageRequest(
        @NotBlank(message = "Action is required")
        @Pattern(regexp = "^(BUY|SELL|CLOSE)$", message = "Action must be BUY, SELL, or CLOSE")
        String action,

        @NotBlank(message = "Ticker is required")
        String ticker,

        BigDecimal shares,

        BigDecimal amount
) {}
