package com.example.finsentinel.dto.market;

import java.math.BigDecimal;

/**
 * Standardized OHLCV bar for historical price data across all market data providers.
 *
 * <p>Represents a single daily aggregate bar, independent of the upstream data source.
 * Financial values use {@link BigDecimal} to preserve broker-level precision.
 *
 * @param open   opening price for the bar
 * @param high   highest price during the bar
 * @param low    lowest price during the bar
 * @param close  closing price for the bar
 * @param volume total shares traded during the bar
 * @param timestamp bar timestamp in epoch milliseconds
 */
public record MarketBar(
        BigDecimal open,
        BigDecimal high,
        BigDecimal low,
        BigDecimal close,
        long volume,
        long timestamp
) {}
