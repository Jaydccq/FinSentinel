package com.example.finsentinel.service.scraper;

import com.example.finsentinel.config.FirecrawlProperties;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.Map;

@Service
@Slf4j
public class FirecrawlClient {

    private final RestClient restClient;
    private final FirecrawlProperties properties;

    public FirecrawlClient(RestClient.Builder restClientBuilder, FirecrawlProperties properties) {
        this.properties = properties;
        this.restClient = restClientBuilder
                .baseUrl(properties.getBaseUrl())
                .defaultHeader("Authorization", "Bearer " + properties.getApiKey())
                .build();
    }

    /**
     * Scrape a single URL and return the markdown content.
     * Returns null if scraping fails.
     */
    public ScrapeResult scrape(String url) {
        try {
            JsonNode response = restClient.post()
                    .uri("/scrape")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of(
                            "url", url,
                            "formats", new String[]{"markdown"}
                    ))
                    .retrieve()
                    .body(JsonNode.class);

            if (response != null && response.has("data")) {
                JsonNode data = response.get("data");
                String markdown = data.has("markdown") ? data.get("markdown").asText() : "";
                String title = data.has("metadata") && data.get("metadata").has("title")
                        ? data.get("metadata").get("title").asText()
                        : url;
                return new ScrapeResult(title, markdown, url);
            }
            log.warn("Firecrawl returned no data for URL: {}", url);
            return null;
        } catch (Exception e) {
            log.error("Firecrawl scrape failed for URL: {}", url, e);
            return null;
        }
    }

    public record ScrapeResult(String title, String markdown, String sourceUrl) {}
}
