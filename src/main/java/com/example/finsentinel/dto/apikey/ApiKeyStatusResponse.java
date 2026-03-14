package com.example.finsentinel.dto.apikey;

/**
 * Response DTO representing the configuration status of a known API key.
 *
 * @param name          the key identifier (e.g. POLYGON_API_KEY)
 * @param label         human-readable label (e.g. "Polygon.io API Key")
 * @param configured    whether the key is stored in the database
 * @param maskedPreview masked preview showing last 4 chars (e.g. "****abcd"), or null if not configured
 * @param category      grouping category (market-data, ai, trading, news)
 */
public record ApiKeyStatusResponse(
        String name,
        String label,
        boolean configured,
        String maskedPreview,
        String category
) {}
