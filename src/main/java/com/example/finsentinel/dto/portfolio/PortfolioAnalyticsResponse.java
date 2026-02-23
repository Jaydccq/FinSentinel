package com.example.finsentinel.dto.portfolio;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

public record PortfolioAnalyticsResponse(
        BigDecimal totalMarketValue,
        Map<String, BigDecimal> sectorAllocation,
        double hhiIndex,
        String hhiClassification,
        List<HoldingWeight> holdingWeights,
        List<String> concentrationWarnings
) {
    public record HoldingWeight(
            String symbol,
            String companyName,
            String sector,
            BigDecimal marketValue,
            BigDecimal weightPercent,
            BigDecimal unrealizedPnl,
            BigDecimal pnlPercent
    ) {}
}
