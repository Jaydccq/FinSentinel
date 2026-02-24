package com.example.finsentinel.dto.research;

import java.math.BigDecimal;

/**
 * A single result from the equity screener, representing a ticker returned
 * by the Polygon.io reference tickers API or snapshot API.
 *
 * <p>Fields map directly to Polygon's {@code /v3/reference/tickers} response
 * shape: {@code ticker}, {@code name}, {@code primary_exchange}, {@code type},
 * {@code locale}, {@code market_cap}, {@code currency_name}, {@code active}.
 */
public record ScreenerResult(
        String ticker,
        String name,
        String primaryExchange, // MIC code, e.g. "XNAS", "XNYS"
        String type,            // "CS" (common stock), "ETF", etc.
        String locale,          // "us"
        BigDecimal marketCap,
        String currencyName,
        boolean active
) {}
