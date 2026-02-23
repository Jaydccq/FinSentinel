package com.example.finsentinel.service.scraper;

import com.example.finsentinel.config.FirecrawlProperties;
import tools.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.Map;

/**
 * Implements firecrawl client business operations and integrations.
 *
 * <p>This class is part of the service layer in FinSentinel.
 */

@Service
@Slf4j
public class FirecrawlClient {

    private final RestClient restClient;
    private final FirecrawlProperties properties;

    /**
     * Creates a new FirecrawlClient instance.
     *
     * <p>This method is defined in {@link FirecrawlClient}.
     * @param restClientBuilder rest client builder (RestClient.Builder)
     * @param properties properties (FirecrawlProperties)
     */

    public FirecrawlClient(RestClient.Builder restClientBuilder, FirecrawlProperties properties) {
        this.properties = properties;
        this.restClient = restClientBuilder
                .baseUrl(properties.getBaseUrl())
                .defaultHeader("Authorization", "Bearer " + properties.getApiKey())
                .build();
    }

    private static final int MAX_RETRIES = 3;
    private static final long INITIAL_BACKOFF_MS = 1000;

    /**
     * Scrape a single URL and return the markdown content.
     * Returns null if scraping fails after all retries.
     */
    public ScrapeResult scrape(String url) {
        for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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
                log.warn("Firecrawl returned no data for URL (attempt {}/{}): {}", attempt, MAX_RETRIES, url);
            } catch (Exception e) {
                log.warn("Firecrawl scrape failed (attempt {}/{}): {} - {}", attempt, MAX_RETRIES, url, e.getMessage());
                if (attempt < MAX_RETRIES) {
                    try {
                        long backoffMs = INITIAL_BACKOFF_MS * (1L << (attempt - 1));
                        Thread.sleep(backoffMs);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        return null;
                    }
                }
            }
        }
        log.error("Firecrawl scrape failed after {} retries for URL: {}", MAX_RETRIES, url);
        return null;
    }

    /**
     * Implements scrape result business operations and integrations.
     *
     * <p>This record belongs to the service layer in FinSentinel.
     */

    public record ScrapeResult(String title, String markdown, String sourceUrl) {}
}
