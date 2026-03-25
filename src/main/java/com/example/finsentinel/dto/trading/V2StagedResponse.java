package com.example.finsentinel.dto.trading;

import java.util.List;

/**
 * Structured response for staged operations in v2 UTA endpoints.
 * Matches the frontend's V2StagedOrders TypeScript interface.
 */
public record V2StagedResponse(
        List<V2CommitResponse.V2OperationResponse> operations,
        int count
) {}
