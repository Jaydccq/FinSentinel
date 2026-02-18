package com.example.finsentinel.service.scraper;

import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.service.storage.MinioStorageService;
import com.example.finsentinel.stream.VectorizeStreamProducer;
import com.example.finsentinel.util.MarkdownToPdfConverter;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class InvestopediaScraper {

    private static final String DICTIONARY_URL = "https://www.investopedia.com/financial-term-dictionary-4769738";
    private static final String INVESTOPEDIA_BASE = "https://www.investopedia.com";

    private final FirecrawlClient firecrawlClient;
    private final MinioStorageService storageService;
    private final DocumentRepository documentRepository;
    private final VectorizeStreamProducer vectorizeStreamProducer;

    /**
     * Scrape Investopedia financial terms dictionary.
     * First scrapes the dictionary index page to extract term URLs,
     * then scrapes each term page for content.
     *
     * @param maxTerms maximum number of terms to scrape (0 = all)
     * @return number of successfully scraped terms
     */
    public int scrape(int maxTerms) {
        log.info("Starting Investopedia scrape (maxTerms={})", maxTerms);

        // Step 1: Scrape the dictionary index page to find term links
        List<String> termUrls = discoverTermUrls();
        if (termUrls.isEmpty()) {
            log.warn("No term URLs discovered from Investopedia dictionary");
            return 0;
        }

        int limit = maxTerms > 0 ? Math.min(maxTerms, termUrls.size()) : termUrls.size();
        log.info("Discovered {} term URLs, will scrape {}", termUrls.size(), limit);

        int successCount = 0;
        for (int i = 0; i < limit; i++) {
            String url = termUrls.get(i);
            try {
                if (scrapeTerm(url)) {
                    successCount++;
                }
                // Rate limit: small delay between requests
                if (i < limit - 1) {
                    Thread.sleep(500);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                log.error("Failed to scrape term: {}", url, e);
            }
        }

        log.info("Investopedia scrape complete: {}/{} terms successful", successCount, limit);
        return successCount;
    }

    private List<String> discoverTermUrls() {
        FirecrawlClient.ScrapeResult indexResult = firecrawlClient.scrape(DICTIONARY_URL);
        if (indexResult == null || indexResult.markdown().isBlank()) {
            return List.of();
        }

        // Parse markdown for Investopedia term links
        List<String> urls = new ArrayList<>();
        String[] lines = indexResult.markdown().split("\n");
        for (String line : lines) {
            // Look for markdown links like [Term Name](/terms/t/term-4589532)
            int linkStart = line.indexOf("](/");
            while (linkStart != -1) {
                int linkEnd = line.indexOf(")", linkStart + 2);
                if (linkEnd != -1) {
                    String path = line.substring(linkStart + 2, linkEnd);
                    if (path.startsWith("/terms/") || path.startsWith("/ask/")) {
                        urls.add(INVESTOPEDIA_BASE + path);
                    }
                }
                linkStart = line.indexOf("](/", linkEnd > 0 ? linkEnd : linkStart + 1);
            }
        }
        return urls;
    }

    private boolean scrapeTerm(String url) {
        FirecrawlClient.ScrapeResult result = firecrawlClient.scrape(url);
        if (result == null || result.markdown().isBlank()) {
            return false;
        }

        // Dedup: skip if already scraped
        if (documentRepository.existsByOriginalFileName(result.title())) {
            log.debug("Skipping duplicate Investopedia term: {}", result.title());
            return false;
        }

        String safeTitle = result.title().replaceAll("[^a-zA-Z0-9\\s-]", "").trim();
        if (safeTitle.isEmpty()) safeTitle = "investopedia-term";

        // Convert to PDF
        byte[] pdfBytes = MarkdownToPdfConverter.convert(result.title(), result.markdown());

        // Upload to MinIO
        String storageKey = "investopedia/" + UUID.randomUUID() + "/" + safeTitle + ".pdf";
        storageService.upload(storageKey, pdfBytes, "application/pdf");

        // Save document entity
        Document doc = Document.builder()
                .fileName(safeTitle + ".pdf")
                .originalFileName(result.title())
                .docType(DocumentType.RESEARCH_REPORT)
                .sector(null)
                .regionId("US")
                .fileSize((long) pdfBytes.length)
                .storageKey(storageKey)
                .build();
        documentRepository.save(doc);
        vectorizeStreamProducer.send(doc.getId());

        log.debug("Scraped Investopedia term: {}", result.title());
        return true;
    }
}
