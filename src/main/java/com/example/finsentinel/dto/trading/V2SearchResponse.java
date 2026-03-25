package com.example.finsentinel.dto.trading;

/**
 * Structured asset search result for v2 UTA endpoints.
 * Matches the frontend's AssetSearchResult TypeScript interface.
 */
public record V2SearchResponse(
        String symbol,
        String name,
        String securityType,
        String exchange
) {}
