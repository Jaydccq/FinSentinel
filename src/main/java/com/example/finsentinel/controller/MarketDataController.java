package com.example.finsentinel.controller;

import com.example.finsentinel.ratelimit.RateLimit;
import com.example.finsentinel.service.MarketDataService;
import tools.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Exposes REST endpoints for market data controller operations.
 *
 * <p>This class belongs to the controller layer in FinSentinel.
 */

@RestController
@RequestMapping("/api/market")
@RequiredArgsConstructor
public class MarketDataController {

    private final MarketDataService marketDataService;

    /**
     * Returns quote.
     *
     * <p>This method belongs to {@link MarketDataController} and encapsulates the
     * get quote workflow.
     * @param ticker ticker (String)
     * @return the get quote result (ResponseEntity<Map<String, Object>>)
     */

    @RateLimit(limit = 30, windowSecs = 60, key = "market:quote")
    @GetMapping("/quote/{ticker}")
    public ResponseEntity<Map<String, Object>> getQuote(@PathVariable String ticker) {

        return ResponseEntity.ok(marketDataService.getQuote(ticker));
    }

    /**
     * Returns history.
     *
     * <p>This method belongs to {@link MarketDataController} and encapsulates the
     * get history workflow.
     * @param ticker ticker (String)
     * @param days days (int)
     * @return the get history result (ResponseEntity<JsonNode>)
     */

    @GetMapping("/history/{ticker}")
    public ResponseEntity<JsonNode> getHistory(

            @PathVariable String ticker,
            @RequestParam(defaultValue = "30") int days) {
        return ResponseEntity.ok(marketDataService.getHistory(ticker, days));
    }

    /**
     * Returns batch quotes.
     *
     * <p>This method is defined in {@link MarketDataController}.
     * @param tickers tickers (List<String>)
     * @return the get batch quotes result (ResponseEntity<Map<String, Object>>)
     */

    @RateLimit(limit = 10, windowSecs = 60, key = "market:batch")
    @PostMapping("/batch-quotes")
    public ResponseEntity<Map<String, Object>> getBatchQuotes(

            @RequestBody List<String> tickers) {
        return ResponseEntity.ok(marketDataService.getBatchQuotes(tickers));
    }
}
