package com.example.finsentinel.controller;

import com.example.finsentinel.dto.news.NewsFeedStatsResponse;
import com.example.finsentinel.dto.news.NewsItemResponse;
import com.example.finsentinel.model.NewsItem;
import com.example.finsentinel.model.enums.NewsSource;
import com.example.finsentinel.repository.NewsItemRepository;
import com.example.finsentinel.service.news.NewsItemCreatedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

@Slf4j
@RestController
@RequestMapping("/api/news")
@RequiredArgsConstructor
public class NewsController {

    private final NewsItemRepository newsItemRepository;
    private final CopyOnWriteArrayList<SseEmitter> emitters = new CopyOnWriteArrayList<>();

    @GetMapping
    public Page<NewsItemResponse> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) NewsSource source) {

        Page<NewsItem> items = source != null
                ? newsItemRepository.findByOptionalSource(source, PageRequest.of(page, size))
                : newsItemRepository.findAllByOrderByPublishedAtDesc(PageRequest.of(page, size));

        return items.map(this::toResponse);
    }

    @GetMapping("/by-ticker/{ticker}")
    public Page<NewsItemResponse> byTicker(
            @PathVariable String ticker,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {

        String normalized = ticker.toUpperCase().trim();
        if (!normalized.matches("^[A-Z]{1,5}(\\.[A-Z]{1,2})?$")) {
            return Page.empty(PageRequest.of(page, size));
        }
        return newsItemRepository.findByTickerContaining(normalized, PageRequest.of(page, size))
                .map(this::toResponse);
    }

    @GetMapping("/stats")
    public NewsFeedStatsResponse stats() {
        Instant todayStart = Instant.now().truncatedTo(ChronoUnit.DAYS);
        long todayCount = newsItemRepository.countByCreatedAtAfter(todayStart);
        long totalCount = newsItemRepository.count();

        Map<String, Long> countBySource = new LinkedHashMap<>();
        for (Object[] row : newsItemRepository.countBySourceAfter(todayStart)) {
            countBySource.put((String) row[0], ((Number) row[1]).longValue());
        }

        return new NewsFeedStatsResponse(todayCount, totalCount, countBySource);
    }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream() {
        SseEmitter emitter = new SseEmitter(0L);
        emitters.add(emitter);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> emitters.remove(emitter));
        emitter.onError(e -> emitters.remove(emitter));
        return emitter;
    }

    @EventListener
    public void onNewsItemCreated(NewsItemCreatedEvent event) {
        NewsItemResponse dto = toResponse(event.getNewsItem());

        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event()
                        .name("news")
                        .data(dto, MediaType.APPLICATION_JSON));
            } catch (IOException e) {
                emitters.remove(emitter);
            }
        }
    }

    private NewsItemResponse toResponse(NewsItem item) {
        return new NewsItemResponse(
                item.getId(),
                item.getSourceId(),
                item.getSource(),
                item.getTitle(),
                item.getSummary(),
                item.getArticleUrl(),
                item.getAuthor(),
                item.getPublishedAt(),
                item.getTickers(),
                item.getTags(),
                item.getSentiment(),
                item.isEnriched()
        );
    }
}
