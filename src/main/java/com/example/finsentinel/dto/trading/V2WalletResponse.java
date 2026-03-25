package com.example.finsentinel.dto.trading;

import java.math.BigDecimal;
import java.util.List;

/**
 * Structured wallet response for v2 UTA endpoints.
 * Matches the frontend's V2WalletStatus TypeScript interface.
 */
public record V2WalletResponse(
        BigDecimal cashBalance,
        BigDecimal initialCapital,
        BigDecimal totalValue,
        BigDecimal returnPercent,
        String tradingMode,
        List<V2PositionResponse> positions
) {
    public record V2PositionResponse(
            String symbol,
            BigDecimal qty,
            BigDecimal avgCost,
            BigDecimal currentPrice,
            BigDecimal marketValue,
            BigDecimal unrealizedPnl,
            BigDecimal pnlPercent,
            String securityType
    ) {}
}
