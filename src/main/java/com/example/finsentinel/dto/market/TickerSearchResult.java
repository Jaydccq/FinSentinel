package com.example.finsentinel.dto.market;

public record TickerSearchResult(
    String symbol,
    String name,
    String exchange,
    String assetType
) {}
