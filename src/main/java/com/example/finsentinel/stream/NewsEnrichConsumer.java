package com.example.finsentinel.stream;

import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.NewsItem;
import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.repository.NewsItemRepository;
import com.example.finsentinel.service.scraper.FirecrawlClient;
import com.example.finsentinel.service.storage.StorageService;
import com.example.finsentinel.util.MarkdownToPdfConverter;
import com.example.finsentinel.util.SectorMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.connection.stream.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "app.news.enrich.enabled", havingValue = "true")
public class NewsEnrichConsumer {

    private final StringRedisTemplate redisTemplate;
    private final NewsItemRepository newsItemRepository;
    private final DocumentRepository documentRepository;
    private final FirecrawlClient firecrawlClient;
    private final StorageService storageService;
    private final VectorizeStreamProducer vectorizeStreamProducer;
    private final NewsEnrichProducer newsEnrichProducer;

    private final String consumerName = "news-enrich-" + UUID.randomUUID().toString().substring(0, 8);

    @PostConstruct
    public void init() {
        try {
            redisTemplate.opsForStream().createGroup(
                    VectorizeStreamConstants.NEWS_ENRICH_STREAM_KEY,
                    ReadOffset.from("0"),
                    VectorizeStreamConstants.NEWS_ENRICH_GROUP_NAME);
            log.info("Created consumer group: {}", VectorizeStreamConstants.NEWS_ENRICH_GROUP_NAME);
        } catch (Exception e) {
            log.debug("Consumer group already exists: {}", VectorizeStreamConstants.NEWS_ENRICH_GROUP_NAME);
        }
    }

    @Scheduled(fixedDelay = 2000)
    public void consume() {
        try {
            List<MapRecord<String, Object, Object>> messages = redisTemplate.opsForStream().read(
                    Consumer.from(VectorizeStreamConstants.NEWS_ENRICH_GROUP_NAME, consumerName),
                    StreamReadOptions.empty().count(5).block(Duration.ofMillis(500)),
                    StreamOffset.create(VectorizeStreamConstants.NEWS_ENRICH_STREAM_KEY, ReadOffset.lastConsumed())
            );

            if (messages == null || messages.isEmpty()) {
                return;
            }

            for (MapRecord<String, Object, Object> message : messages) {
                processMessage(message);
            }
        } catch (Exception e) {
            log.error("Error consuming from news-enrich stream", e);
        }
    }

    private void processMessage(MapRecord<String, Object, Object> message) {
        Map<Object, Object> body = message.getValue();
        String newsItemIdStr = (String) body.get(VectorizeStreamConstants.FIELD_NEWS_ITEM_ID);
        String retryCountStr = (String) body.getOrDefault(VectorizeStreamConstants.FIELD_RETRY_COUNT, "0");
        int retryCount = Integer.parseInt(retryCountStr);

        UUID newsItemId;
        try {
            newsItemId = UUID.fromString(newsItemIdStr);
        } catch (Exception e) {
            log.error("Invalid newsItemId in message: {}", newsItemIdStr);
            ack(message);
            return;
        }

        NewsItem newsItem = newsItemRepository.findById(newsItemId).orElse(null);
        if (newsItem == null) {
            log.warn("NewsItem not found, skipping: {}", newsItemId);
            ack(message);
            return;
        }

        if (newsItem.isEnriched()) {
            log.debug("NewsItem already enriched, skipping: {}", newsItemId);
            ack(message);
            return;
        }

        try {
            String articleUrl = newsItem.getArticleUrl();
            if (articleUrl == null || articleUrl.isBlank()) {
                log.debug("No article URL for news item {}, skipping enrichment", newsItemId);
                ack(message);
                return;
            }

            FirecrawlClient.ScrapeResult scraped = firecrawlClient.scrape(articleUrl);
            if (scraped == null || scraped.markdown().isBlank()) {
                log.warn("Firecrawl returned no content for {}", articleUrl);
                ack(message);
                return;
            }

            // Build markdown with metadata
            String primaryTicker = newsItem.getTickers() != null && !newsItem.getTickers().isEmpty()
                    ? newsItem.getTickers().getFirst() : "general";
            String sector = SectorMapper.fromTicker(primaryTicker);

            StringBuilder markdown = new StringBuilder();
            markdown.append("# ").append(newsItem.getTitle()).append("\n\n");
            if (newsItem.getAuthor() != null) {
                markdown.append("**Author:** ").append(newsItem.getAuthor()).append("\n");
            }
            markdown.append("**Published:** ").append(newsItem.getPublishedAt()).append("\n");
            markdown.append("**Source:** ").append(articleUrl).append("\n");
            markdown.append("\n---\n\n");
            markdown.append(scraped.markdown());

            if (newsItem.getTickers() != null && !newsItem.getTickers().isEmpty()) {
                markdown.append("\n\n**Related Tickers:** ");
                newsItem.getTickers().forEach(t -> markdown.append(t).append(" "));
            }

            byte[] pdfBytes = MarkdownToPdfConverter.convert(newsItem.getTitle(), markdown.toString());

            String storageKey = "news/" + primaryTicker + "/" + UUID.randomUUID() + ".pdf";
            storageService.upload(storageKey, pdfBytes, "application/pdf");

            String safeTitle = newsItem.getTitle().replaceAll("[^a-zA-Z0-9\\s-]", "").trim();
            if (safeTitle.length() > 80) safeTitle = safeTitle.substring(0, 80);

            Document doc = Document.builder()
                    .fileName(safeTitle + ".pdf")
                    .originalFileName(newsItem.getTitle())
                    .docType(DocumentType.NEWS)
                    .sector(sector)
                    .regionId("US")
                    .fileSize((long) pdfBytes.length)
                    .storageKey(storageKey)
                    .build();
            documentRepository.save(doc);

            vectorizeStreamProducer.send(doc.getId());

            newsItem.setEnriched(true);
            newsItem.setDocumentId(doc.getId());
            newsItemRepository.save(newsItem);

            log.info("Enriched news item {}: document={}", newsItemId, doc.getId());

        } catch (Exception e) {
            log.error("Failed to enrich news item {} (retry={})", newsItemId, retryCount, e);

            if (retryCount < VectorizeStreamConstants.MAX_RETRIES) {
                newsEnrichProducer.send(newsItemId, retryCount + 1);
            } else {
                log.error("News item {} failed enrichment after {} retries", newsItemId, VectorizeStreamConstants.MAX_RETRIES);
            }
        } finally {
            ack(message);
        }
    }

    private void ack(MapRecord<String, Object, Object> message) {
        redisTemplate.opsForStream().acknowledge(
                VectorizeStreamConstants.NEWS_ENRICH_STREAM_KEY,
                VectorizeStreamConstants.NEWS_ENRICH_GROUP_NAME,
                message.getId()
        );
    }
}
