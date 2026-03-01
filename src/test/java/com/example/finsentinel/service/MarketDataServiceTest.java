package com.example.finsentinel.service;

import com.example.finsentinel.dto.market.MarketBar;
import com.example.finsentinel.dto.market.MarketQuote;
import com.example.finsentinel.service.market.MarketDataProvider;
import com.example.finsentinel.service.market.MarketDataProviderRegistry;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link MarketDataService} verifying caching, batch handling,
 * ticker validation, and delegation to the provider registry.
 */
@ExtendWith(MockitoExtension.class)
class MarketDataServiceTest {

    @Mock private MarketDataProviderRegistry providerRegistry;
    @Mock private MarketDataProvider provider;
    @Mock private StringRedisTemplate redisTemplate;
    @Mock private ValueOperations<String, String> valueOps;
    @Mock private org.springframework.web.client.RestClient restClient;

    private MarketDataService service;
    private final ObjectMapper objectMapper = JsonMapper.builder().build();

    @BeforeEach
    void setUp() {
        service = new MarketDataService(providerRegistry, redisTemplate, objectMapper, restClient);
    }

    @Test
    void getQuote_shouldReturnStructuredDataFromProvider() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get("market:quote:AAPL")).thenReturn(null);
        when(providerRegistry.getDefaultProvider()).thenReturn(provider);
        when(provider.getQuote("AAPL")).thenReturn(new MarketQuote(
                "AAPL",
                BigDecimal.valueOf(150.0),
                BigDecimal.valueOf(155.0),
                BigDecimal.valueOf(149.0),
                BigDecimal.valueOf(153.5),
                50000000L,
                1708128000000L
        ));

        Map<String, Object> result = service.getQuote("AAPL");

        assertThat(result).containsEntry("ticker", "AAPL");
        assertThat(result).containsEntry("close", BigDecimal.valueOf(153.5));
        assertThat(result).containsEntry("open", BigDecimal.valueOf(150.0));
        assertThat(result).containsEntry("high", BigDecimal.valueOf(155.0));
        assertThat(result).containsEntry("low", BigDecimal.valueOf(149.0));
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
        // Provider should never be called when cache hits
        verifyNoInteractions(providerRegistry);
    }

    @Test
    void getHistory_shouldRespectDaysBounds() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(anyString())).thenReturn(null);
        when(providerRegistry.getDefaultProvider()).thenReturn(provider);
        when(provider.getHistoricalBars("AAPL", 365)).thenReturn(List.of(
                new MarketBar(
                        BigDecimal.valueOf(150.0),
                        BigDecimal.valueOf(155.0),
                        BigDecimal.valueOf(149.0),
                        BigDecimal.valueOf(153.5),
                        50000000L,
                        1708128000000L
                )
        ));

        JsonNode result = service.getHistory("AAPL", 500); // should cap at 365

        assertThat(result).isNotNull();
        verify(provider).getHistoricalBars("AAPL", 365);
        verify(valueOps).set(startsWith("market:history:AAPL:365"), anyString(), eq(Duration.ofMinutes(30)));
    }

    @Test
    void getBatchQuotes_shouldHandleMixedResults() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        String cachedJson = """
                {"ticker":"AAPL","close":153.5,"open":150.0,"high":155.0,"low":149.0,"volume":50000000,"timestamp":1708128000000}""";
        when(valueOps.get("market:quote:AAPL")).thenReturn(cachedJson);
        // XYZ is a valid ticker (1-5 chars) but provider will throw
        when(valueOps.get("market:quote:XYZ")).thenReturn(null);
        when(providerRegistry.getDefaultProvider()).thenReturn(provider);
        when(provider.getQuote("XYZ")).thenThrow(new IllegalArgumentException("No market data available for XYZ"));

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

    @Test
    void validateTicker_cryptoFormat_accepted() {
        // Crypto hyphenated format (Yahoo Finance style)
        assertThat(service.validateTicker("btc-usd")).isEqualTo("BTC-USD");
        assertThat(service.validateTicker("ETH-USD")).isEqualTo("ETH-USD");
        assertThat(service.validateTicker("sol-usd")).isEqualTo("SOL-USD");
        // Existing formats still work
        assertThat(service.validateTicker("aapl")).isEqualTo("AAPL");
        assertThat(service.validateTicker("BTC/USD")).isEqualTo("BTC/USD");
        // Dot suffix (e.g. London Stock Exchange)
        assertThat(service.validateTicker("AAPL.L")).isEqualTo("AAPL.L");
    }

    @Test
    void validateTicker_shouldRejectNull() {
        assertThatThrownBy(() -> service.validateTicker(null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("null");
    }
}
