package com.example.finsentinel.dto.news;

import java.util.Map;

public record NewsFeedStatsResponse(
        long todayCount,
        long totalCount,
        Map<String, Long> countBySource
) {}
