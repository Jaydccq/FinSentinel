package com.example.finsentinel.controller;

import com.example.finsentinel.ratelimit.RateLimit;
import com.example.finsentinel.service.openbb.OpenbbPublicDataService;
import tools.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/openbb/public")
@RequiredArgsConstructor
public class OpenbbPublicDataController {

    private final OpenbbPublicDataService openbbPublicDataService;

    @GetMapping("/providers")
    public ResponseEntity<Map<String, Object>> providers() {
        return ResponseEntity.ok(openbbPublicDataService.getPublicConnectorStatus());
    }

    @RateLimit(limit = 30, windowSecs = 60, key = "openbb:query")
    @GetMapping("/query")
    public ResponseEntity<JsonNode> query(
            @RequestParam String path,
            @RequestParam(required = false) String provider,
            @RequestParam Map<String, String> params) {
        Map<String, String> queryParams = new LinkedHashMap<>(params);
        queryParams.remove("path");
        queryParams.remove("provider");

        return ResponseEntity.ok(openbbPublicDataService.queryPublicData(path, provider, queryParams));
    }
}
