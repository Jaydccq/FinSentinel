package com.example.finsentinel.service;

import com.example.finsentinel.config.PolygonProperties;
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

import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Implements market data service test business operations and integrations.
 *
 * <p>This class belongs to the service layer in FinSentinel.
 */

@ExtendWith(MockitoExtension.class)
class MarketDataServiceTest {

    @Mock private RestClient restClient;
    @Mock private RestClient.RequestHeadersUriSpec requestHeadersUriSpec;
    @Mock private RestClient.RequestHeadersSpec requestHeadersSpec;
    @Mock private RestClient.ResponseSpec responseSpec;
    @Mock private StringRedisTemplate redisTemplate;
    @Mock private ValueOperations<String, String> valueOps;

    private MarketDataService service;
    private final ObjectMapper objectMapper = new ObjectMapper();


    @BeforeEach
    void setUp() {
        PolygonProperties props = new PolygonProperties();
        props.setApiKey("test-key");
        props.setBaseUrl("https://api.polygon.io");
        service = new MarketDataService(restClient, props, redisTemplate, objectMapper);
    }


    @Test
    void getQuote_shouldReturnStructuredDataFromApi() throws Exception {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("market:quote:AAPL")).thenReturn(null);

        String apiResponse = """
                {"results":[{"o":150.0,"h":155.0,"l":149.0,"c":153.5,"v":50000000,"t":1708128000000}]}""";
        JsonNode responseNode = objectMapper.readTree(apiResponse);

        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(JsonNode.class)).thenReturn(responseNode);

        Map<String, Object> result = service.getQuote("AAPL");

        assertThat(result).containsEntry("ticker", "AAPL");
        assertThat(result).containsEntry("close", 153.5);
        assertThat(result).containsEntry("open", 150.0);
        assertThat(result).containsEntry("high", 155.0);
        assertThat(result).containsEntry("low", 149.0);
        assertThat(result).containsEntry("volume", 50000000L);
        verify(valueOps).set(eq("market:quote:AAPL"), anyString(), eq(Duration.ofMinutes(5)));
    }


    @Test
    void getQuote_shouldUseCacheOnSecondCall() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        String cachedJson = """
                {"ticker":"AAPL","close":153.5,"open":150.0,"high":155.0,"low":149.0,"volume":50000000,"timestamp":1708128000000}""";
        when(valueOps.get("market:quote:AAPL")).thenReturn(cachedJson);

        Map<String, Object> result = service.getQuote("AAPL");

        assertThat(result).containsEntry("ticker", "AAPL");
        verify(restClient, never()).get();
    }


    @Test
    void getHistory_shouldRespectDaysBounds() throws Exception {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(anyString())).thenReturn(null);

        String apiResponse = """
                {"results":[{"o":150.0,"h":155.0,"l":149.0,"c":153.5,"v":50000000,"t":1708128000000}]}""";
        JsonNode responseNode = objectMapper.readTree(apiResponse);

        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(JsonNode.class)).thenReturn(responseNode);

        JsonNode result = service.getHistory("AAPL", 500); // should cap at 365

        assertThat(result).isNotNull();
        verify(valueOps).set(startsWith("market:history:AAPL:365"), anyString(), eq(Duration.ofMinutes(30)));
    }


    @Test
    void getBatchQuotes_shouldHandleMixedResults() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        String cachedJson = """
                {"ticker":"AAPL","close":153.5,"open":150.0,"high":155.0,"low":149.0,"volume":50000000,"timestamp":1708128000000}""";
        when(valueOps.get("market:quote:AAPL")).thenReturn(cachedJson);
        // XYZ is a valid ticker (1-5 chars) but will fail when Polygon returns null
        when(valueOps.get("market:quote:XYZ")).thenReturn(null);

        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(JsonNode.class)).thenReturn(null);

        Map<String, Object> result = service.getBatchQuotes(List.of("AAPL", "XYZ"));

        assertThat(result).containsKey("AAPL");
        assertThat(result).containsKey("XYZ");
        // AAPL should have cached data, XYZ should have error
        assertThat(result.get("AAPL")).isInstanceOf(Map.class);
        assertThat(result.get("XYZ")).isInstanceOf(Map.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> xyzResult = (Map<String, Object>) result.get("XYZ");
        assertThat(xyzResult).containsKey("error");
    }


    @Test
    void validateTicker_shouldRejectInvalidSymbols() {
        assertThatThrownBy(() -> service.getQuote("invalid123"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid ticker");
    }
}
