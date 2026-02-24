package com.example.finsentinel.dto.market;

import java.math.BigDecimal;

/**
 * Standardized real-time quote across all market data providers.
 *
 * <p>Fields follow the OpenBB Fetcher convention: provider-agnostic OHLCV snapshot
 * with a Unix-millis timestamp. Financial values use {@link BigDecimal} to preserve
 * broker-level precision.
 *
 * @param ticker stock ticker symbol (e.g. AAPL)
 * @param open   opening price for the period
 * @param high   highest price during the period
 * @param low    lowest price during the period
 * @param close  closing price for the period
 * @param volume total shares traded during the period
 * @param timestamp data point timestamp in epoch milliseconds
 */
public record MarketQuote(
        String ticker,
        BigDecimal open,
        BigDecimal high,
        BigDecimal low,
        BigDecimal close,
        long volume,
        long timestamp
) {}
