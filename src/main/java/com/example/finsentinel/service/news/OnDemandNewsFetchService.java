package com.example.finsentinel.service.news;

import com.example.finsentinel.config.NewsProperties;
import com.example.finsentinel.model.NewsItem;
import com.example.finsentinel.repository.NewsItemRepository;
import com.example.finsentinel.stream.NewsEnrichProducer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class OnDemandNewsFetchService {

    private final List<NewsFetcher> fetchers;
    private final NewsItemRepository newsItemRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final NewsEnrichProducer newsEnrichProducer;
    private final NewsProperties newsProperties;

    public Page<NewsItem> fetchAndSave(String ticker, PageRequest pageRequest) {
        int totalSaved = 0;

        for (NewsFetcher fetcher : fetchers) {
            try {
                List<NewsFetcher.RawNewsItem> items = fetcher.fetch(List.of(ticker));
                for (NewsFetcher.RawNewsItem raw : items) {
                    if (newsItemRepository.existsBySourceAndSourceId(raw.source(), raw.sourceId())) {
                        continue;
                    }

                    NewsItem entity = toEntity(raw);
                    newsItemRepository.save(entity);
                    eventPublisher.publishEvent(new NewsItemCreatedEvent(this, entity));

                    if (newsProperties.getEnrich().isEnabled()
                            && raw.articleUrl() != null && !raw.articleUrl().isBlank()) {
                        newsEnrichProducer.send(entity.getId());
                    }
                    totalSaved++;
                }
            } catch (Exception e) {
                log.error("On-demand fetch failed for {} from {}", ticker, fetcher.getSource(), e);
            }
        }

        if (totalSaved > 0) {
            log.info("On-demand fetched and saved {} items for {}", totalSaved, ticker);
        }

        return newsItemRepository.findByTickerContaining(ticker, pageRequest);
    }

    private NewsItem toEntity(NewsFetcher.RawNewsItem raw) {
        return NewsItem.builder()
                .sourceId(raw.sourceId())
                .source(raw.source())
                .title(raw.title())
                .summary(raw.summary())
                .articleUrl(raw.articleUrl())
                .author(raw.author())
                .publishedAt(raw.publishedAt())
                .tickers(raw.tickers())
                .tags(raw.tags())
                .build();
    }
}
