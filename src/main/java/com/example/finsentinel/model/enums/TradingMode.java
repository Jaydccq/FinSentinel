package com.example.finsentinel.model.enums;

/**
 * Represents the trading execution mode.
 *
 * <p>This enum is part of the model layer in FinSentinel.
 */

public enum TradingMode {
    PAPER,  // Simulated execution against market prices (default)
    LIVE    // Real broker execution via Alpaca/CCXT
}
