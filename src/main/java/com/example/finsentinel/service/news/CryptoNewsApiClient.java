package com.example.finsentinel.service.news;

import com.example.finsentinel.config.CryptoNewsProperties;
import tools.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@ConditionalOnProperty(name = "app.crypto-news.enabled", havingValue = "true")
public class CryptoNewsApiClient {

    private final RestClient restClient;
    private final CryptoNewsProperties properties;

    public CryptoNewsApiClient(RestClient.Builder restClientBuilder,
                                CryptoNewsProperties properties) {
        this.properties = properties;
        this.restClient = restClientBuilder
                .baseUrl(properties.getBaseUrl())
                .defaultHeader("Authorization", "Bearer " + properties.getApiToken())
                .defaultHeader("Content-Type", "application/json")
                .build();
    }

    public JsonNode searchNews(List<String> coins, String query,
                                Map<String, List<String>> engineTypes,
                                boolean hasCoin, int limit, int page) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("limit", Math.min(limit, properties.getMaxResultsPerFetch()));
        body.put("page", page);
        if (coins != null && !coins.isEmpty()) body.put("coins", coins);
        if (query != null && !query.isBlank()) body.put("q", query);
        if (engineTypes != null && !engineTypes.isEmpty()) body.put("engineTypes", engineTypes);
        if (hasCoin) body.put("hasCoin", true);

        return restClient.post()
                .uri("/open/news_search")
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(JsonNode.class);
    }

    public JsonNode getNewsSources() {
        return restClient.get()
                .uri("/open/news_type")
                .retrieve()
                .body(JsonNode.class);
    }
}
