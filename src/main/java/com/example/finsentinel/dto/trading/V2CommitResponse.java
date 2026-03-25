package com.example.finsentinel.dto.trading;

import java.util.List;
import java.util.Map;

/**
 * Structured commit/execution response for v2 UTA endpoints.
 * Matches the frontend's V2TradeCommit TypeScript interface.
 */
public record V2CommitResponse(
        String hash,
        String parentHash,
        String message,
        String timestamp,
        List<V2OperationResponse> operations,
        List<Map<String, Object>> results
) {
    public record V2OperationResponse(
            String action,
            String symbol,
            String qty,
            String amount,
            String price
    ) {}
}
