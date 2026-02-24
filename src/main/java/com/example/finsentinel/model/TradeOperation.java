package com.example.finsentinel.model;

import java.math.BigDecimal;

/**
 * Represents a single staged trade operation in the git-like wallet workflow.
 *
 * <p>Trade operations are staged in-memory before being committed and executed.
 * This mirrors the git staging area pattern from OpenAlice's wallet design.
 *
 * <p>Specify either {@code shares} (number of shares) or {@code amount} (dollar amount)
 * for BUY/SELL actions. For CLOSE, both can be null since all shares are sold.
 * A null {@code price} indicates a market order using the current market price.
 *
 * @param action the trade action: "BUY", "SELL", or "CLOSE"
 * @param ticker the stock ticker symbol (e.g., "AAPL")
 * @param shares number of shares to trade (alternative to amount)
 * @param amount dollar amount to trade (alternative to shares)
 * @param price  limit price, or null for market order using current price
 */
public record TradeOperation(
        String action,
        String ticker,
        BigDecimal shares,
        BigDecimal amount,
        BigDecimal price
) {}
