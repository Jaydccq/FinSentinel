package com.example.finsentinel.service.scraper;

import com.example.finsentinel.config.PolygonProperties;
import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.service.storage.MinioStorageService;
import com.example.finsentinel.util.MarkdownToPdfConverter;
import com.example.finsentinel.stream.VectorizeStreamProducer;
import com.example.finsentinel.util.SectorMapper;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class PolygonNewsScraper {

    private final PolygonProperties polygonProperties;
    private final MinioStorageService storageService;
    private final DocumentRepository documentRepository;
    private final RestClient restClient;
    private final VectorizeStreamProducer vectorizeStreamProducer;
    private final FirecrawlClient firecrawlClient;

    /**
     * Fetch financial news from Polygon.io API for the given tickers.
     * Uses Firecrawl to scrape full article content when available.
     *
     * @param tickers list of stock tickers
     * @param days    how many days back to fetch
     * @return number of news articles saved
     */
    public int scrape(List<String> tickers, int days) {
        log.info("Starting Polygon news scrape for tickers: {}, days: {}", tickers, days);
        int successCount = 0;

        String publishedAfter = LocalDate.now().minusDays(days)
                .format(DateTimeFormatter.ISO_LOCAL_DATE);

        for (String ticker : tickers) {
            try {
                JsonNode response = restClient.get()
                        .uri(polygonProperties.getBaseUrl() +
                                        "/v2/reference/news?ticker={ticker}&published_utc.gte={date}&limit=50&apiKey={apiKey}",
                                ticker, publishedAfter, polygonProperties.getApiKey())
                        .retrieve()
                        .body(JsonNode.class);

                if (response != null && response.has("results")) {
                    for (JsonNode article : response.get("results")) {
                        try {
                            if (saveArticle(article, ticker)) {
                                successCount++;
                            }
                        } catch (Exception e) {
                            log.error("Failed to save news article for {}", ticker, e);
                        }
                    }
                }
            } catch (Exception e) {
                log.error("Failed to fetch Polygon news for {}", ticker, e);
            }
        }

        log.info("Polygon news scrape complete: {} articles saved", successCount);
        return successCount;
    }

    private boolean saveArticle(JsonNode article, String ticker) {
        String title = article.has("title") ? article.get("title").asText() : "Untitled";
        String description = article.has("description") ? article.get("description").asText() : "";
        String author = article.has("author") ? article.get("author").asText() : "Unknown";
        String publishedUtc = article.has("published_utc") ? article.get("published_utc").asText() : "";
        String articleUrl = article.has("article_url") ? article.get("article_url").asText() : "";

        // Dedup: skip if already scraped
        if (documentRepository.existsByOriginalFileName(title)) {
            log.debug("Skipping duplicate news article: {}", title);
            return false;
        }

        // Try to scrape full article content via Firecrawl, fall back to description
        String fullContent = description;
        if (!articleUrl.isEmpty()) {
            try {
                FirecrawlClient.ScrapeResult scraped = firecrawlClient.scrape(articleUrl);
                if (scraped != null && !scraped.markdown().isBlank()) {
                    fullContent = scraped.markdown();
                    log.debug("Scraped full article for: {}", title);
                }
            } catch (Exception e) {
                log.warn("Firecrawl failed for {}, using description fallback", articleUrl);
            }
        }

        // Build markdown content
        StringBuilder markdown = new StringBuilder();
        markdown.append("# ").append(title).append("\n\n");
        markdown.append("**Author:** ").append(author).append("\n");
        markdown.append("**Published:** ").append(publishedUtc).append("\n");
        markdown.append("**Ticker:** ").append(ticker).append("\n");
        if (!articleUrl.isEmpty()) {
            markdown.append("**Source:** ").append(articleUrl).append("\n");
        }
        markdown.append("\n---\n\n");
        markdown.append(fullContent);

        // Include keywords/tickers if available
        if (article.has("tickers")) {
            markdown.append("\n\n**Related Tickers:** ");
            for (JsonNode t : article.get("tickers")) {
                markdown.append(t.asText()).append(" ");
            }
        }

        byte[] pdfBytes = MarkdownToPdfConverter.convert(title, markdown.toString());

        String safeTitle = title.replaceAll("[^a-zA-Z0-9\\s-]", "").trim();
        if (safeTitle.length() > 80) safeTitle = safeTitle.substring(0, 80);

        String storageKey = "news/" + ticker + "/" + UUID.randomUUID() + ".pdf";
        storageService.upload(storageKey, pdfBytes, "application/pdf");

        Document doc = Document.builder()
                .fileName(safeTitle + ".pdf")
                .originalFileName(title)
                .docType(DocumentType.NEWS)
                .sector(SectorMapper.fromTicker(ticker))
                .regionId("US")
                .fileSize((long) pdfBytes.length)
                .storageKey(storageKey)
                .build();
        documentRepository.save(doc);
        vectorizeStreamProducer.send(doc.getId());

        log.debug("Saved news article: {} for {}", title, ticker);
        return true;
    }

}
