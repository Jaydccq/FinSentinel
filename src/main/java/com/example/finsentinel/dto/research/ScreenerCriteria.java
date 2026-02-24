package com.example.finsentinel.dto.research;

import java.math.BigDecimal;

/**
 * Criteria for screening equities via the Polygon.io ticker reference API.
 *
 * <p>All filter fields are optional. The compact constructor enforces sensible
 * defaults for {@code limit}, {@code sortBy}, and {@code order} when callers
 * leave them null or out-of-range.
 */
public record ScreenerCriteria(
        String sector,           // Filter by sector (optional)
        String exchange,         // "NYSE", "NASDAQ" mapped to MIC codes (optional)
        BigDecimal marketCapMin, // Min market cap (optional)
        BigDecimal marketCapMax, // Max market cap (optional)
        String search,           // Name/ticker search query (optional)
        String sortBy,           // "market_cap", "name", "ticker" (default: "market_cap")
        String order,            // "asc" or "desc" (default: "desc")
        int limit                // Max results (default: 20, max: 50)
) {
    public ScreenerCriteria {
        if (limit <= 0 || limit > 50) limit = 20;
        if (sortBy == null || sortBy.isBlank()) sortBy = "market_cap";
        if (order == null || order.isBlank()) order = "desc";
    }
}
