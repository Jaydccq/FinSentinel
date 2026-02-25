package com.example.finsentinel.dto.news;

import java.time.Instant;

public record NewsSummaryResponse(
    String ticker,
    String summary,
    int articleCount,
    Instant generatedAt
) {}
