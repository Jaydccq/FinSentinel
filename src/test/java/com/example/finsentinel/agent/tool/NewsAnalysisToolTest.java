package com.example.finsentinel.agent.tool;

import com.example.finsentinel.config.PolygonProperties;
import com.example.finsentinel.service.rag.RagRetrievalService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.web.client.RestClient;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NewsAnalysisToolTest {

    @Mock private RestClient restClient;
    @Mock private RestClient.RequestHeadersUriSpec requestHeadersUriSpec;
    @Mock private RestClient.RequestHeadersSpec requestHeadersSpec;
    @Mock private RestClient.ResponseSpec responseSpec;
    @Mock private RagRetrievalService ragRetrievalService;
    @Mock private StringRedisTemplate redisTemplate;
    @Mock private ValueOperations<String, String> valueOperations;

    private PolygonProperties polygonProperties;
    private ObjectMapper objectMapper;
    private NewsAnalysisTool newsAnalysisTool;

    @BeforeEach
    void setUp() {
        polygonProperties = new PolygonProperties();
        polygonProperties.setApiKey("test-key");
        polygonProperties.setBaseUrl("https://api.polygon.io");
        objectMapper = new ObjectMapper();
        newsAnalysisTool = new NewsAnalysisTool(restClient, polygonProperties, ragRetrievalService, redisTemplate, objectMapper);
    }

    @Test
    void getRecentNews_shouldReturnFormattedNews() throws Exception {
        String apiResponse = """
            {
                "results": [{
                    "title": "Apple Reports Record Q4 Earnings",
                    "description": "Apple Inc reported strong earnings driven by iPhone sales.",
                    "author": "Reuters",
                    "published_utc": "2026-02-15T10:00:00Z",
                    "tickers": ["AAPL"]
                }]
            }
            """;
        JsonNode responseNode = objectMapper.readTree(apiResponse);

        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get(anyString())).thenReturn(null);
        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(JsonNode.class)).thenReturn(responseNode);

        String result = newsAnalysisTool.getRecentNews("AAPL", 7);

        assertThat(result).contains("Apple Reports Record Q4 Earnings");
        assertThat(result).contains("Reuters");
    }

    @Test
    void searchRagKnowledgeBase_shouldDelegateToRagService() {
        when(ragRetrievalService.search(anyString(), anyInt(), anyString(), isNull(), isNull(), isNull()))
                .thenReturn(List.of());

        String result = newsAnalysisTool.searchKnowledgeBase("AAPL earnings analysis", "NEWS", null);

        verify(ragRetrievalService).search("AAPL earnings analysis", 8, "NEWS", null, null, null);
        assertThat(result).contains("No relevant documents found");
    }
}
