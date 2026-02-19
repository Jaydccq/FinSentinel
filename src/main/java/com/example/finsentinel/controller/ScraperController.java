package com.example.finsentinel.controller;

import com.example.finsentinel.service.scraper.KnowledgeBaseScraperService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Exposes REST endpoints for scraper controller operations.
 *
 * <p>This class belongs to the controller layer in FinSentinel.
 */

@RestController
@RequestMapping("/api/scraper")
@RequiredArgsConstructor
public class ScraperController {

    private final KnowledgeBaseScraperService scraperService;

    /**
     * Executes scrape investopedia.
     *
     * <p>This method is defined in {@link ScraperController}.
     * @param body body (Map<String, Object>)
     * @return the scrape investopedia result (ResponseEntity<Map<String, Object>>)
     */

    @PostMapping("/investopedia")
    public ResponseEntity<Map<String, Object>> scrapeInvestopedia(
            @RequestBody(required = false) Map<String, Object> body) {
        int maxTerms = 50;
        if (body != null && body.containsKey("maxTerms")) {
            maxTerms = ((Number) body.get("maxTerms")).intValue();
        }

        return ResponseEntity.ok(scraperService.scrapeInvestopedia(maxTerms));
    }

    /**
     * Executes scrape sec filings.
     *
     * <p>This method is defined in {@link ScraperController}.
     * @param body body (Map<String, Object>)
     * @return the scrape sec filings result (ResponseEntity<Map<String, Object>>)
     */

    @PostMapping("/sec-filings")
    public ResponseEntity<Map<String, Object>> scrapeSecFilings(
            @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<String> tickers = (List<String>) body.getOrDefault("tickers",
                List.of("AAPL", "MSFT", "GOOGL", "TSLA", "JPM"));

        return ResponseEntity.ok(scraperService.scrapeSecFilings(tickers));
    }

    /**
     * Executes scrape news.
     *
     * <p>This method is defined in {@link ScraperController}.
     * @param body body (Map<String, Object>)
     * @return the scrape news result (ResponseEntity<Map<String, Object>>)
     */

    @PostMapping("/news")
    public ResponseEntity<Map<String, Object>> scrapeNews(
            @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<String> tickers = (List<String>) body.getOrDefault("tickers",
                List.of("AAPL", "MSFT", "GOOGL", "TSLA", "JPM"));
        int days = body.containsKey("days") ? ((Number) body.get("days")).intValue() : 7;

        return ResponseEntity.ok(scraperService.scrapeNews(tickers, days));
    }

    /**
     * Executes scrape all.
     *
     * <p>This method is defined in {@link ScraperController}.
     * @return the scrape all result (ResponseEntity<Map<String, Object>>)
     */

    @PostMapping("/all")
    public ResponseEntity<Map<String, Object>> scrapeAll() {

        return ResponseEntity.ok(scraperService.scrapeAll());
    }

    /**
     * Returns status.
     *
     * <p>This method is defined in {@link ScraperController}.
     * @return the get status result (ResponseEntity<Map<String, Object>>)
     */

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getStatus() {

        return ResponseEntity.ok(scraperService.getStatus());
    }
}
