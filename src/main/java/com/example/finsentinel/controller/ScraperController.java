package com.example.finsentinel.controller;

import com.example.finsentinel.service.scraper.KnowledgeBaseScraperService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/scraper")
@RequiredArgsConstructor
public class ScraperController {

    private final KnowledgeBaseScraperService scraperService;

    @PostMapping("/investopedia")
    public ResponseEntity<Map<String, Object>> scrapeInvestopedia(
            @RequestBody(required = false) Map<String, Object> body) {
        int maxTerms = 50;
        if (body != null && body.containsKey("maxTerms")) {
            maxTerms = ((Number) body.get("maxTerms")).intValue();
        }
        return ResponseEntity.ok(scraperService.scrapeInvestopedia(maxTerms));
    }

    @PostMapping("/sec-filings")
    public ResponseEntity<Map<String, Object>> scrapeSecFilings(
            @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<String> tickers = (List<String>) body.getOrDefault("tickers",
                List.of("AAPL", "MSFT", "GOOGL", "TSLA", "JPM"));
        return ResponseEntity.ok(scraperService.scrapeSecFilings(tickers));
    }

    @PostMapping("/news")
    public ResponseEntity<Map<String, Object>> scrapeNews(
            @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<String> tickers = (List<String>) body.getOrDefault("tickers",
                List.of("AAPL", "MSFT", "GOOGL", "TSLA", "JPM"));
        int days = body.containsKey("days") ? ((Number) body.get("days")).intValue() : 7;
        return ResponseEntity.ok(scraperService.scrapeNews(tickers, days));
    }

    @PostMapping("/all")
    public ResponseEntity<Map<String, Object>> scrapeAll() {
        return ResponseEntity.ok(scraperService.scrapeAll());
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getStatus() {
        return ResponseEntity.ok(scraperService.getStatus());
    }
}
