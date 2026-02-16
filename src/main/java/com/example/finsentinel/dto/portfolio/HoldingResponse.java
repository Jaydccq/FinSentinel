package com.example.finsentinel.dto.portfolio;

import java.math.BigDecimal;
import java.util.UUID;

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
