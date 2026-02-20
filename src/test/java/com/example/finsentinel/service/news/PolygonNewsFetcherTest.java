package com.example.finsentinel.service.news;

import com.example.finsentinel.config.PolygonProperties;
import com.example.finsentinel.model.enums.NewsSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.client.RestClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PolygonNewsFetcherTest {

    @Mock private RestClient restClient;
    @Mock private RestClient.RequestHeadersUriSpec requestHeadersUriSpec;
    @Mock private RestClient.RequestHeadersSpec requestHeadersSpec;
    @Mock private RestClient.ResponseSpec responseSpec;

    private PolygonProperties polygonProperties;
    private PolygonNewsFetcher fetcher;
    private ObjectMapper objectMapper = JsonMapper.builder().build();

    @BeforeEach
    void setUp() {
        polygonProperties = new PolygonProperties();
        polygonProperties.setApiKey("test-key");
        polygonProperties.setBaseUrl("https://api.polygon.io");
        fetcher = new PolygonNewsFetcher(polygonProperties, restClient);
    }

    @Test
    void getSource_returnsPolygon() {
        assertThat(fetcher.getSource()).isEqualTo(NewsSource.POLYGON);
    }

    @Test
    void fetch_parsesArticlesCorrectly() throws Exception {
        String json = """
                {
                  "results": [
                    {
                      "id": "abc123",
                      "title": "Apple Reports Q4 Earnings",
                      "description": "Apple exceeded expectations",
                      "author": "John Doe",
                      "article_url": "https://example.com/apple",
                      "published_utc": "2026-02-19T12:00:00Z",
                      "tickers": ["AAPL", "MSFT"],
                      "keywords": ["earnings", "tech"]
                    }
                  ]
                }
                """;

        mockRestClient(json);

        List<NewsFetcher.RawNewsItem> results = fetcher.fetch(List.of("AAPL"));

        assertThat(results).hasSize(1);
        NewsFetcher.RawNewsItem item = results.getFirst();
        assertThat(item.sourceId()).isEqualTo("abc123");
        assertThat(item.source()).isEqualTo(NewsSource.POLYGON);
        assertThat(item.title()).isEqualTo("Apple Reports Q4 Earnings");
        assertThat(item.summary()).isEqualTo("Apple exceeded expectations");
        assertThat(item.author()).isEqualTo("John Doe");
        assertThat(item.articleUrl()).isEqualTo("https://example.com/apple");
        assertThat(item.tickers()).contains("AAPL", "MSFT");
        assertThat(item.tags()).containsExactly("earnings", "tech");
    }

    @Test
    void fetch_skipsArticlesWithNoId() throws Exception {
        String json = """
                {
                  "results": [
                    {
                      "title": "No ID Article",
                      "description": "Missing id field"
                    }
                  ]
                }
                """;

        mockRestClient(json);

        List<NewsFetcher.RawNewsItem> results = fetcher.fetch(List.of("AAPL"));

        assertThat(results).isEmpty();
    }

    @Test
    void fetch_handlesEmptyResults() throws Exception {
        String json = """
                { "results": [] }
                """;

        mockRestClient(json);

        List<NewsFetcher.RawNewsItem> results = fetcher.fetch(List.of("AAPL"));

        assertThat(results).isEmpty();
    }

    @Test
    void fetch_handlesApiError() {
        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenThrow(new RuntimeException("API error"));

        List<NewsFetcher.RawNewsItem> results = fetcher.fetch(List.of("AAPL"));

        assertThat(results).isEmpty();
    }

    @Test
    void fetch_deduplicatesTickerFromQueryAndResponse() throws Exception {
        String json = """
                {
                  "results": [
                    {
                      "id": "xyz",
                      "title": "Test",
                      "published_utc": "2026-02-19T12:00:00Z",
                      "tickers": ["AAPL", "GOOGL"]
                    }
                  ]
                }
                """;

        mockRestClient(json);

        List<NewsFetcher.RawNewsItem> results = fetcher.fetch(List.of("AAPL"));

        assertThat(results.getFirst().tickers()).containsExactly("AAPL", "GOOGL");
    }

    private void mockRestClient(String responseJson) throws Exception {
        JsonNode node = objectMapper.readTree(responseJson);
        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(JsonNode.class)).thenReturn(node);
    }
}
