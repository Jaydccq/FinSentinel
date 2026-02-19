package com.example.finsentinel.dto.portfolio;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * API response payload representing one holding item.
 *
 * @param id holding identifier
 * @param symbol ticker symbol
 * @param companyName company name
 * @param quantity holding quantity
 * @param averageCost average acquisition cost
 * @param currentPrice latest known market price
 * @param sector sector label
 */
public record HoldingResponse(
        UUID id,
        String symbol,
        String companyName,
        BigDecimal quantity,
        BigDecimal averageCost,
        BigDecimal currentPrice,
        String sector
) {
}
