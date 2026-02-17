package com.example.finsentinel.controller;

import com.example.finsentinel.service.MarketDataService;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/market")
@RequiredArgsConstructor
public class MarketDataController {

    private final MarketDataService marketDataService;

    @GetMapping("/quote/{ticker}")
    public ResponseEntity<Map<String, Object>> getQuote(@PathVariable String ticker) {
        return ResponseEntity.ok(marketDataService.getQuote(ticker));
    }

    @GetMapping("/history/{ticker}")
    public ResponseEntity<JsonNode> getHistory(
            @PathVariable String ticker,
            @RequestParam(defaultValue = "30") int days) {
        return ResponseEntity.ok(marketDataService.getHistory(ticker, days));
    }

    @PostMapping("/batch-quotes")
    public ResponseEntity<Map<String, Object>> getBatchQuotes(
            @RequestBody List<String> tickers) {
        return ResponseEntity.ok(marketDataService.getBatchQuotes(tickers));
    }
}
