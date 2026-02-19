package com.example.finsentinel.service.news;

import com.example.finsentinel.config.NewsProperties;
import com.example.finsentinel.model.NewsItem;
import com.example.finsentinel.model.enums.NewsSource;
import com.example.finsentinel.repository.NewsItemRepository;
import com.example.finsentinel.stream.NewsEnrichProducer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NewsFetcherServiceTest {

    @Mock private NewsItemRepository newsItemRepository;
    @Mock private ApplicationEventPublisher eventPublisher;
    @Mock private NewsEnrichProducer newsEnrichProducer;
    @Mock private NewsFetcher mockFetcher;

    private NewsProperties newsProperties;
    private NewsFetcherService service;

    @BeforeEach
    void setUp() {
        newsProperties = new NewsProperties();
        newsProperties.setWatchTickers(List.of("AAPL", "MSFT"));
        newsProperties.getEnrich().setEnabled(true);

        service = new NewsFetcherService(
                List.of(mockFetcher),
                newsItemRepository,
                eventPublisher,
                newsEnrichProducer,
                newsProperties
        );
    }

    @Test
    void pollAll_savesNewItemsAndPublishesEvents() {
        when(mockFetcher.getSource()).thenReturn(NewsSource.POLYGON);
        when(mockFetcher.fetch(any())).thenReturn(List.of(
                new NewsFetcher.RawNewsItem(
                        "article-1", NewsSource.POLYGON, "Test Title",
                        "Summary", "https://example.com/1", "Author",
                        Instant.now(), List.of("AAPL"), List.of("earnings")
                )
        ));
        when(newsItemRepository.existsBySourceAndSourceId(any(), any())).thenReturn(false);
        when(newsItemRepository.save(any(NewsItem.class))).thenAnswer(inv -> {
            NewsItem item = inv.getArgument(0);
            item.setId(java.util.UUID.randomUUID());
            return item;
        });

        service.pollAll();

        verify(newsItemRepository).save(any(NewsItem.class));
        verify(eventPublisher).publishEvent(any(NewsItemCreatedEvent.class));
        verify(newsEnrichProducer).send(any());
    }

    @Test
    void pollAll_skipsDuplicates() {
        when(mockFetcher.fetch(any())).thenReturn(List.of(
                new NewsFetcher.RawNewsItem(
                        "article-dup", NewsSource.POLYGON, "Duplicate",
                        "Summary", "https://example.com/dup", null,
                        Instant.now(), List.of(), List.of()
                )
        ));
        when(newsItemRepository.existsBySourceAndSourceId(NewsSource.POLYGON, "article-dup")).thenReturn(true);

        service.pollAll();

        verify(newsItemRepository, never()).save(any());
        verify(eventPublisher, never()).publishEvent(any());
    }

    @Test
    void pollAll_skipsEnrichWhenNoArticleUrl() {
        when(mockFetcher.getSource()).thenReturn(NewsSource.POLYGON);
        when(mockFetcher.fetch(any())).thenReturn(List.of(
                new NewsFetcher.RawNewsItem(
                        "article-no-url", NewsSource.POLYGON, "No URL Article",
                        "Summary", null, null,
                        Instant.now(), List.of("TSLA"), List.of()
                )
        ));
        when(newsItemRepository.existsBySourceAndSourceId(any(), any())).thenReturn(false);
        when(newsItemRepository.save(any(NewsItem.class))).thenAnswer(inv -> {
            NewsItem item = inv.getArgument(0);
            item.setId(java.util.UUID.randomUUID());
            return item;
        });

        service.pollAll();

        verify(newsItemRepository).save(any(NewsItem.class));
        verify(eventPublisher).publishEvent(any(NewsItemCreatedEvent.class));
        verify(newsEnrichProducer, never()).send(any());
    }

    @Test
    void pollAll_handlesExceptionFromFetcher() {
        when(mockFetcher.getSource()).thenReturn(NewsSource.POLYGON);
        when(mockFetcher.fetch(any())).thenThrow(new RuntimeException("API error"));

        service.pollAll();

        verify(newsItemRepository, never()).save(any());
    }

    @Test
    void pollAll_mapsRawItemToEntityCorrectly() {
        Instant now = Instant.now();
        when(mockFetcher.getSource()).thenReturn(NewsSource.POLYGON);
        when(mockFetcher.fetch(any())).thenReturn(List.of(
                new NewsFetcher.RawNewsItem(
                        "id-123", NewsSource.POLYGON, "Title",
                        "Sum", "https://url.com", "Auth",
                        now, List.of("AAPL", "MSFT"), List.of("tech")
                )
        ));
        when(newsItemRepository.existsBySourceAndSourceId(any(), any())).thenReturn(false);
        when(newsItemRepository.save(any(NewsItem.class))).thenAnswer(inv -> {
            NewsItem item = inv.getArgument(0);
            item.setId(java.util.UUID.randomUUID());
            return item;
        });

        service.pollAll();

        ArgumentCaptor<NewsItem> captor = ArgumentCaptor.forClass(NewsItem.class);
        verify(newsItemRepository).save(captor.capture());

        NewsItem saved = captor.getValue();
        assertThat(saved.getSourceId()).isEqualTo("id-123");
        assertThat(saved.getSource()).isEqualTo(NewsSource.POLYGON);
        assertThat(saved.getTitle()).isEqualTo("Title");
        assertThat(saved.getSummary()).isEqualTo("Sum");
        assertThat(saved.getArticleUrl()).isEqualTo("https://url.com");
        assertThat(saved.getAuthor()).isEqualTo("Auth");
        assertThat(saved.getPublishedAt()).isEqualTo(now);
        assertThat(saved.getTickers()).containsExactly("AAPL", "MSFT");
        assertThat(saved.getTags()).containsExactly("tech");
        assertThat(saved.isEnriched()).isFalse();
    }
}
