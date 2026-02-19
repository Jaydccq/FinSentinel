package com.example.finsentinel.service.news;

import com.example.finsentinel.config.NewsProperties;
import com.example.finsentinel.model.NewsItem;
import com.example.finsentinel.repository.NewsItemRepository;
import com.example.finsentinel.stream.NewsEnrichProducer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
@ConditionalOnProperty(name = "app.news.enabled", havingValue = "true", matchIfMissing = true)
public class NewsFetcherService {

    private final List<NewsFetcher> fetchers;
    private final NewsItemRepository newsItemRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final NewsEnrichProducer newsEnrichProducer;
    private final NewsProperties newsProperties;

    @Scheduled(fixedDelayString = "${app.news.poll-interval:60000}")
    public void pollAll() {
        List<String> tickers = newsProperties.getWatchTickers();
        log.debug("Polling news for tickers: {}", tickers);

        for (NewsFetcher fetcher : fetchers) {
            try {
                List<NewsFetcher.RawNewsItem> items = fetcher.fetch(tickers);
                int saved = 0;

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

                    saved++;
                }

                if (saved > 0) {
                    log.info("Saved {} new items from {}", saved, fetcher.getSource());
                }
            } catch (Exception e) {
                log.error("Fetch failed for source: {}", fetcher.getSource(), e);
            }
        }
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
