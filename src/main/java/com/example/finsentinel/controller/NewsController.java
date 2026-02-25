package com.example.finsentinel.controller;

import com.example.finsentinel.agent.RiskAgentService;
import com.example.finsentinel.dto.news.NewsFeedStatsResponse;
import com.example.finsentinel.dto.news.NewsItemResponse;
import com.example.finsentinel.dto.news.NewsSummaryResponse;
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
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

@Slf4j
@RestController
@RequestMapping("/api/news")
@RequiredArgsConstructor
public class NewsController {

    private final NewsItemRepository newsItemRepository;
    private final RiskAgentService riskAgentService;
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

    @GetMapping("/summary/{ticker}")
    public ResponseEntity<NewsSummaryResponse> summarizeNews(@PathVariable String ticker) {
        String normalized = ticker.toUpperCase().trim();
        if (!normalized.matches("^[A-Z]{1,10}([/\\\\\\-.][A-Z]{1,5})?$")) {
            return ResponseEntity.badRequest().build();
        }

        // For crypto tickers like BTC-USD, use the base symbol for news search
        String searchTicker = normalized.contains("-") ? normalized.split("-")[0] : normalized;

        // Fetch latest 15 news items for this ticker
        Page<NewsItem> newsPage = newsItemRepository.findByTickerContaining(
                searchTicker, PageRequest.of(0, 15));
        List<NewsItem> items = newsPage.getContent();

        if (items.isEmpty()) {
            return ResponseEntity.ok(new NewsSummaryResponse(
                    normalized, "No recent news found for " + normalized, 0, Instant.now()));
        }

        // Build prompt from headlines + summaries
        StringBuilder newsContext = new StringBuilder();
        for (NewsItem item : items) {
            newsContext.append("- ").append(item.getTitle());
            if (item.getSummary() != null && !item.getSummary().isBlank()) {
                newsContext.append(": ").append(item.getSummary());
            }
            newsContext.append("\n");
        }

        String prompt = String.format(
                "Summarize the following recent news about %s in 3-5 sentences. " +
                "Focus on key themes, market impact, and sentiment. Be concise and factual.\n\n%s",
                normalized, newsContext);

        String summary = riskAgentService.quickChat(prompt);

        return ResponseEntity.ok(new NewsSummaryResponse(
                normalized, summary, items.size(), Instant.now()));
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
