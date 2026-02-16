package com.example.finsentinel.service.scraper;

import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.service.storage.MinioStorageService;
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
public class SecEdgarScraper {

    private static final String EDGAR_SEARCH_URL = "https://efts.sec.gov/LATEST/search-index";
    private static final String EDGAR_FILING_BASE = "https://www.sec.gov/Archives/edgar/data/";

    private final FirecrawlClient firecrawlClient;
    private final MinioStorageService storageService;
    private final DocumentRepository documentRepository;
    private final RestClient restClient;

    /**
     * Scrape SEC EDGAR filings for the given tickers.
     *
     * @param tickers list of stock tickers (e.g., ["AAPL", "TSLA"])
     * @return number of successfully scraped filings
     */
    public int scrape(List<String> tickers) {
        log.info("Starting SEC EDGAR scrape for tickers: {}", tickers);
        int successCount = 0;

        for (String ticker : tickers) {
            try {
                List<String> filingUrls = searchFilings(ticker);
                log.info("Found {} filings for {}", filingUrls.size(), ticker);

                for (String url : filingUrls) {
                    try {
                        if (scrapeFiling(url, ticker)) {
                            successCount++;
                        }
                        Thread.sleep(1000); // SEC rate limit: 10 req/sec
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return successCount;
                    } catch (Exception e) {
                        log.error("Failed to scrape filing: {}", url, e);
                    }
                }
            } catch (Exception e) {
                log.error("Failed to search EDGAR filings for {}", ticker, e);
            }
        }

        log.info("SEC EDGAR scrape complete: {} filings scraped", successCount);
        return successCount;
    }

    private List<String> searchFilings(String ticker) {
        List<String> urls = new ArrayList<>();
        try {
            // Use SEC EDGAR full-text search API
            JsonNode response = restClient.get()
                    .uri("https://efts.sec.gov/LATEST/search-index?q={q}&dateRange=custom&startdt=2024-01-01&forms=10-K,10-Q&hits.hits.total.value=5",
                            ticker)
                    .header("User-Agent", "FinSentinel research@example.com")
                    .retrieve()
                    .body(JsonNode.class);

            if (response != null && response.has("hits") && response.get("hits").has("hits")) {
                for (JsonNode hit : response.get("hits").get("hits")) {
                    if (hit.has("_source") && hit.get("_source").has("file_url")) {
                        String fileUrl = hit.get("_source").get("file_url").asText();
                        urls.add("https://www.sec.gov" + fileUrl);
                    }
                }
            }

            // Fallback: use EDGAR company search if full-text search returns empty
            if (urls.isEmpty()) {
                JsonNode companySearch = restClient.get()
                        .uri("https://efts.sec.gov/LATEST/search-index?q=%22{q}%22+10-K&hits.hits._source=file_url&hits.hits.total.value=3",
                                ticker)
                        .header("User-Agent", "FinSentinel research@example.com")
                        .retrieve()
                        .body(JsonNode.class);

                if (companySearch != null && companySearch.has("hits") && companySearch.get("hits").has("hits")) {
                    for (JsonNode hit : companySearch.get("hits").get("hits")) {
                        if (hit.has("_source") && hit.get("_source").has("file_url")) {
                            urls.add("https://www.sec.gov" + hit.get("_source").get("file_url").asText());
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.warn("EDGAR search failed for {}, trying alternative approach", ticker, e);
            // Fallback: construct known filing URL patterns
            urls.add("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=" +
                    ticker + "&type=10-K&dateb=&owner=include&count=3&search_text=&action=getcompany");
        }
        return urls;
    }

    private boolean scrapeFiling(String url, String ticker) {
        FirecrawlClient.ScrapeResult result = firecrawlClient.scrape(url);
        if (result == null || result.markdown().isBlank()) {
            return false;
        }

        String safeTitle = (ticker + "-" + result.title())
                .replaceAll("[^a-zA-Z0-9\\s-]", "").trim();
        if (safeTitle.length() > 100) safeTitle = safeTitle.substring(0, 100);

        byte[] pdfBytes = MarkdownToPdfConverter.convert(
                ticker + " SEC Filing: " + result.title(), result.markdown());

        String storageKey = "sec-filings/" + ticker + "/" + UUID.randomUUID() + ".pdf";
        storageService.upload(storageKey, pdfBytes, "application/pdf");

        Document doc = Document.builder()
                .fileName(safeTitle + ".pdf")
                .originalFileName(result.title())
                .docType(DocumentType.SEC_FILING)
                .sector(sectorFromTicker(ticker))
                .regionId("US")
                .fileSize((long) pdfBytes.length)
                .storageKey(storageKey)
                .build();
        documentRepository.save(doc);

        log.debug("Scraped SEC filing: {} for {}", result.title(), ticker);
        return true;
    }

    private String sectorFromTicker(String ticker) {
        // Basic sector mapping for common tickers
        return switch (ticker.toUpperCase()) {
            case "AAPL", "MSFT", "GOOGL", "GOOG", "META", "NVDA", "AMD", "INTC" -> "Technology";
            case "JPM", "BAC", "GS", "MS", "WFC", "C" -> "Financial";
            case "JNJ", "PFE", "UNH", "ABBV", "MRK" -> "Healthcare";
            case "TSLA", "F", "GM" -> "Automotive";
            case "AMZN", "WMT", "TGT", "COST" -> "Retail";
            case "XOM", "CVX", "COP" -> "Energy";
            default -> null;
        };
    }
}
