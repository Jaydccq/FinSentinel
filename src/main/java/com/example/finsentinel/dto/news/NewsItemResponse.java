package com.example.finsentinel.dto.news;

import com.example.finsentinel.model.enums.NewsSource;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record NewsItemResponse(
        UUID id,
        String sourceId,
        NewsSource source,
        String title,
        String summary,
        String articleUrl,
        String author,
        Instant publishedAt,
        List<String> tickers,
        List<String> tags,
        String sentiment,
        boolean enriched
) {}
