package com.example.finsentinel.dto.portfolio;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * API response payload representing a portfolio and its holdings.
 *
 * @param id portfolio identifier
 * @param name portfolio name
 * @param description portfolio description
 * @param totalValue computed total market value
 * @param holdings holding rows for this portfolio
 * @param createdAt creation timestamp
 */
public record PortfolioResponse(
        UUID id,
        String name,
        String description,
        BigDecimal totalValue,
        List<HoldingResponse> holdings,
        LocalDateTime createdAt
) {
}
