package com.example.finsentinel.dto.portfolio;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public record PortfolioResponse(
        UUID id,
        String name,
        String description,
        BigDecimal totalValue,
        List<HoldingResponse> holdings,
        LocalDateTime createdAt
) {
}
