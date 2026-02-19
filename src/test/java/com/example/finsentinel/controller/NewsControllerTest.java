package com.example.finsentinel.controller;

import com.example.finsentinel.model.NewsItem;
import com.example.finsentinel.model.enums.NewsSource;
import com.example.finsentinel.repository.NewsItemRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class NewsControllerTest {

    @Mock private NewsItemRepository newsItemRepository;

    private NewsController controller;

    @BeforeEach
    void setUp() {
        controller = new NewsController(newsItemRepository);
    }

    @Test
    void list_returnsPagedResults() {
        NewsItem item = NewsItem.builder()
                .sourceId("abc")
                .source(NewsSource.POLYGON)
                .title("Test News")
                .summary("A test summary")
                .publishedAt(Instant.parse("2026-02-19T10:00:00Z"))
                .tickers(List.of("AAPL"))
                .tags(List.of("tech"))
                .build();
        item.setId(UUID.randomUUID());

        when(newsItemRepository.findAllByOrderByPublishedAtDesc(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(item)));

        var result = controller.list(0, 50, null);

        assertThat(result.getContent()).hasSize(1);
        assertThat(result.getContent().getFirst().title()).isEqualTo("Test News");
        assertThat(result.getContent().getFirst().source()).isEqualTo(NewsSource.POLYGON);
        assertThat(result.getContent().getFirst().tickers()).containsExactly("AAPL");
    }

    @Test
    void list_filtersbySource() {
        NewsItem item = NewsItem.builder()
                .sourceId("rss1")
                .source(NewsSource.RSS_CNBC)
                .title("CNBC Article")
                .publishedAt(Instant.now())
                .build();
        item.setId(UUID.randomUUID());

        when(newsItemRepository.findByOptionalSource(any(NewsSource.class), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(item)));

        var result = controller.list(0, 50, NewsSource.RSS_CNBC);

        assertThat(result.getContent()).hasSize(1);
        assertThat(result.getContent().getFirst().source()).isEqualTo(NewsSource.RSS_CNBC);
    }

    @Test
    void stats_returnsCounts() {
        when(newsItemRepository.countByCreatedAtAfter(any())).thenReturn(5L);
        when(newsItemRepository.count()).thenReturn(100L);
        when(newsItemRepository.countBySourceAfter(any())).thenReturn(
                List.of(new Object[]{"POLYGON", 3L}, new Object[]{"RSS_CNBC", 2L})
        );

        var result = controller.stats();

        assertThat(result.todayCount()).isEqualTo(5);
        assertThat(result.totalCount()).isEqualTo(100);
        assertThat(result.countBySource()).containsEntry("POLYGON", 3L);
        assertThat(result.countBySource()).containsEntry("RSS_CNBC", 2L);
    }

    @Test
    void stream_returnsSseEmitter() {
        SseEmitter emitter = controller.stream();
        assertThat(emitter).isNotNull();
    }
}
