package com.example.finsentinel.controller;

import com.example.finsentinel.dto.scraper.InvestopediaScrapeRequest;
import com.example.finsentinel.ratelimit.RateLimit;
import com.example.finsentinel.dto.scraper.TickerScrapeRequest;
import com.example.finsentinel.service.scraper.KnowledgeBaseScraperService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/scraper")
@RequiredArgsConstructor
public class ScraperController {

    private final KnowledgeBaseScraperService scraperService;

    @RateLimit(limit = 5, windowSecs = 300, key = "scraper:investopedia")
    @PostMapping("/investopedia")
    public ResponseEntity<Map<String, Object>> scrapeInvestopedia(
            @Valid @RequestBody(required = false) InvestopediaScrapeRequest request) {
        int maxTerms = request != null ? request.resolvedMaxTerms() : 50;
        return ResponseEntity.ok(scraperService.scrapeInvestopedia(maxTerms));
    }

    @RateLimit(limit = 10, windowSecs = 600, key = "scraper:sec-filings")
    @PostMapping("/sec-filings")
    public ResponseEntity<Map<String, Object>> scrapeSecFilings(
            @Valid @RequestBody TickerScrapeRequest request) {
        return ResponseEntity.ok(scraperService.scrapeSecFilings(request.resolvedTickers()));
    }

    @RateLimit(limit = 10, windowSecs = 300, key = "scraper:news")
    @PostMapping("/news")
    public ResponseEntity<Map<String, Object>> scrapeNews(
            @Valid @RequestBody TickerScrapeRequest request) {
        return ResponseEntity.ok(scraperService.scrapeNews(request.resolvedTickers(), request.resolvedDays()));
    }

    @RateLimit(limit = 2, windowSecs = 3600, key = "scraper:all")
    @PostMapping("/all")
    public ResponseEntity<Map<String, Object>> scrapeAll() {
        return ResponseEntity.ok(scraperService.scrapeAll());
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getStatus() {
        return ResponseEntity.ok(scraperService.getStatus());
    }
}
