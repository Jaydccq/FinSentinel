package com.example.finsentinel.controller;

import com.example.finsentinel.ratelimit.RateLimit;
import com.example.finsentinel.service.openbb.OpenbbBusinessDataService;
import tools.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/openbb/business")
@RequiredArgsConstructor
public class OpenbbBusinessDataController {

    private final OpenbbBusinessDataService openbbBusinessDataService;

    @RateLimit(limit = 30, windowSecs = 60, key = "openbb:business:cpi")
    @GetMapping("/macro/us/cpi")
    public ResponseEntity<JsonNode> usCpi(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate,
            @RequestParam(required = false) Integer limit) {
        return ResponseEntity.ok(openbbBusinessDataService.getUsCpi(startDate, endDate, limit));
    }

    @RateLimit(limit = 30, windowSecs = 60, key = "openbb:business:unemployment")
    @GetMapping("/macro/us/unemployment")
    public ResponseEntity<JsonNode> usUnemployment(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate,
            @RequestParam(required = false) Integer limit) {
        return ResponseEntity.ok(openbbBusinessDataService.getUsUnemploymentRate(startDate, endDate, limit));
    }

    @RateLimit(limit = 30, windowSecs = 60, key = "openbb:business:fedfunds")
    @GetMapping("/macro/us/fed-funds-rate")
    public ResponseEntity<JsonNode> usFedFundsRate(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate,
            @RequestParam(required = false) Integer limit) {
        return ResponseEntity.ok(openbbBusinessDataService.getUsFedFundsRate(startDate, endDate, limit));
    }
}
