package com.example.finsentinel.stream;

import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.NewsItem;
import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.repository.NewsItemRepository;
import com.example.finsentinel.service.news.NewsSentimentService;
import com.example.finsentinel.service.scraper.FirecrawlClient;
import com.example.finsentinel.service.storage.StorageService;
import com.example.finsentinel.util.MarkdownToPdfConverter;
import com.example.finsentinel.util.SectorMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
@ConditionalOnProperty(name = "app.news.enrich.enabled", havingValue = "true")
public class NewsEnrichConsumer extends AbstractStreamConsumer {

    private final NewsItemRepository newsItemRepository;
    private final DocumentRepository documentRepository;
    private final FirecrawlClient firecrawlClient;
    private final StorageService storageService;
    private final VectorizeStreamProducer vectorizeStreamProducer;
    private final NewsEnrichProducer newsEnrichProducer;
    private final NewsSentimentService newsSentimentService;

    public NewsEnrichConsumer(StringRedisTemplate redisTemplate,
                               NewsItemRepository newsItemRepository,
                               DocumentRepository documentRepository,
                               FirecrawlClient firecrawlClient,
                               StorageService storageService,
                               VectorizeStreamProducer vectorizeStreamProducer,
                               NewsEnrichProducer newsEnrichProducer,
                               NewsSentimentService newsSentimentService) {
        super(redisTemplate,
              VectorizeStreamConstants.NEWS_ENRICH_STREAM_KEY,
              VectorizeStreamConstants.NEWS_ENRICH_GROUP_NAME,
              "news-enrich");
        this.newsItemRepository = newsItemRepository;
        this.documentRepository = documentRepository;
        this.firecrawlClient = firecrawlClient;
        this.storageService = storageService;
        this.vectorizeStreamProducer = vectorizeStreamProducer;
        this.newsEnrichProducer = newsEnrichProducer;
        this.newsSentimentService = newsSentimentService;
    }

    @Scheduled(fixedDelay = 2000)
    public void consume() { doPoll(); }

    /**
     * Reclaims pending messages from dead consumers every 30 seconds.
     * Uses XCLAIM to transfer ownership of messages idle for >30 seconds.
     */
    @Scheduled(fixedDelay = 30_000)
    public void reclaimPending() { doReclaimPending(); }

    @Override
    protected void processMessage(MapRecord<String, Object, Object> message) {
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
            String sentiment = newsSentimentService.classify(newsItem.getTitle(), newsItem.getSummary());
            newsItem.setSentiment(sentiment);
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
}
