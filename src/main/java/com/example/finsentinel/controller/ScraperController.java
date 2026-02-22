package com.example.finsentinel.controller;

import com.example.finsentinel.dto.scraper.InvestopediaScrapeRequest;
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

    @PostMapping("/investopedia")
    public ResponseEntity<Map<String, Object>> scrapeInvestopedia(
            @Valid @RequestBody(required = false) InvestopediaScrapeRequest request) {
        int maxTerms = request != null ? request.resolvedMaxTerms() : 50;
        return ResponseEntity.ok(scraperService.scrapeInvestopedia(maxTerms));
    }

    @PostMapping("/sec-filings")
    public ResponseEntity<Map<String, Object>> scrapeSecFilings(
            @Valid @RequestBody TickerScrapeRequest request) {
        return ResponseEntity.ok(scraperService.scrapeSecFilings(request.resolvedTickers()));
    }

    @PostMapping("/news")
    public ResponseEntity<Map<String, Object>> scrapeNews(
            @Valid @RequestBody TickerScrapeRequest request) {
        return ResponseEntity.ok(scraperService.scrapeNews(request.resolvedTickers(), request.resolvedDays()));
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
