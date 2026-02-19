package com.example.finsentinel.service.news;

import com.example.finsentinel.model.enums.NewsSource;

import java.time.Instant;
import java.util.List;

public interface NewsFetcher {

    NewsSource getSource();

    List<RawNewsItem> fetch(List<String> tickers);

    record RawNewsItem(
            String sourceId,
            NewsSource source,
            String title,
            String summary,
            String articleUrl,
            String author,
            Instant publishedAt,
            List<String> tickers,
            List<String> tags
    ) {}
}
