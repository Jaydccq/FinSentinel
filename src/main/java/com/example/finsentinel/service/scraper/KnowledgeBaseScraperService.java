package com.example.finsentinel.service.scraper;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Implements knowledge base scraper service business operations and integrations.
 *
 * <p>This class is part of the service layer in FinSentinel.
 */

@Service
@Slf4j
@RequiredArgsConstructor
public class KnowledgeBaseScraperService {

    private final InvestopediaScraper investopediaScraper;
    private final SecEdgarScraper secEdgarScraper;
    private final PolygonNewsScraper polygonNewsScraper;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private volatile String currentStatus = "idle";

    /**
     * Run all scrapers with default settings.
     */
    public Map<String, Object> scrapeAll() {
        if (!running.compareAndSet(false, true)) {

            return Map.of("error", "Scraping is already in progress", "status", currentStatus);
        }

        try {
            currentStatus = "running all scrapers in parallel";
            Map<String, Object> results = new HashMap<>();

            CompletableFuture<Integer> investopediaFuture = CompletableFuture.supplyAsync(() -> {
                try {
                    return investopediaScraper.scrape(100);
                } catch (Exception e) {
                    log.error("Investopedia scraper failed", e);
                    return 0;
                }
            });

            CompletableFuture<Integer> secFuture = CompletableFuture.supplyAsync(() -> {
                try {
                    return secEdgarScraper.scrape(List.of("AAPL", "MSFT", "GOOGL", "TSLA", "JPM"));
                } catch (Exception e) {
                    log.error("SEC EDGAR scraper failed", e);
                    return 0;
                }
            });

            CompletableFuture<Integer> newsFuture = CompletableFuture.supplyAsync(() -> {
                try {
                    return polygonNewsScraper.scrape(List.of("AAPL", "MSFT", "GOOGL", "TSLA", "JPM"), 7);
                } catch (Exception e) {
                    log.error("Polygon news scraper failed", e);
                    return 0;
                }
            });

            CompletableFuture.allOf(investopediaFuture, secFuture, newsFuture).join();

            results.put("investopedia", investopediaFuture.join());
            results.put("secFilings", secFuture.join());
            results.put("news", newsFuture.join());

            currentStatus = "completed";
            results.put("status", "completed");
            return results;
        } finally {
            running.set(false);
        }
    }

    /**
     * Executes scrape investopedia.
     *
     * <p>This method belongs to {@link KnowledgeBaseScraperService} and encapsulates the
     * scrape investopedia workflow.
     * @param maxTerms max terms (int)
     * @return the scrape investopedia result (Map<String, Object>)
     */

    public Map<String, Object> scrapeInvestopedia(int maxTerms) {
        if (!running.compareAndSet(false, true)) {

            return Map.of("error", "Scraping is already in progress");
        }
        try {
            currentStatus = "scraping Investopedia terms";
            int count = investopediaScraper.scrape(maxTerms);
            currentStatus = "idle";

            return Map.of("status", "completed", "termsScraped", count);
        } finally {
            running.set(false);
        }
    }

    /**
     * Executes scrape sec filings.
     *
     * <p>This method belongs to {@link KnowledgeBaseScraperService} and encapsulates the
     * scrape sec filings workflow.
     * @param tickers tickers (List<String>)
     * @return the scrape sec filings result (Map<String, Object>)
     */

    public Map<String, Object> scrapeSecFilings(List<String> tickers) {
        if (!running.compareAndSet(false, true)) {

            return Map.of("error", "Scraping is already in progress");
        }
        try {
            currentStatus = "scraping SEC EDGAR filings";
            int count = secEdgarScraper.scrape(tickers);
            currentStatus = "idle";

            return Map.of("status", "completed", "filingsScraped", count);
        } finally {
            running.set(false);
        }
    }

    /**
     * Executes scrape news.
     *
     * <p>This method belongs to {@link KnowledgeBaseScraperService} and encapsulates the
     * scrape news workflow.
     * @param tickers tickers (List<String>)
     * @param days days (int)
     * @return the scrape news result (Map<String, Object>)
     */

    public Map<String, Object> scrapeNews(List<String> tickers, int days) {
        if (!running.compareAndSet(false, true)) {

            return Map.of("error", "Scraping is already in progress");
        }
        try {
            currentStatus = "scraping Polygon news";
            int count = polygonNewsScraper.scrape(tickers, days);
            currentStatus = "idle";

            return Map.of("status", "completed", "articlesSaved", count);
        } finally {
            running.set(false);
        }
    }

    /**
     * Returns status.
     *
     * <p>This method belongs to {@link KnowledgeBaseScraperService} and encapsulates the
     * get status workflow.
     * @return the get status result (Map<String, Object>)
     */

    public Map<String, Object> getStatus() {

        return Map.of(
                "running", running.get(),
                "currentStatus", currentStatus
        );
    }
}
