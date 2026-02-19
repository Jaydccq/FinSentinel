package com.example.finsentinel.controller;

import com.example.finsentinel.service.MarketDataService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * Exposes REST endpoints for market data controller test operations.
 *
 * <p>This class belongs to the controller layer in FinSentinel.
 */

@ExtendWith(MockitoExtension.class)
class MarketDataControllerTest {

    @Mock private MarketDataService marketDataService;

    private MarketDataController controller;
    private final ObjectMapper objectMapper = new ObjectMapper();


    @BeforeEach
    void setUp() {
        controller = new MarketDataController(marketDataService);
    }


    @Test
    void getQuote_shouldReturnMarketData() {
        Map<String, Object> quoteData = Map.of(
                "ticker", "AAPL", "close", 175.50,
                "open", 176.00, "high", 178.00, "low", 174.20,
                "volume", 52345678L);
        when(marketDataService.getQuote("AAPL")).thenReturn(quoteData);

        ResponseEntity<Map<String, Object>> response = controller.getQuote("AAPL");

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).containsEntry("ticker", "AAPL");
        assertThat(response.getBody()).containsEntry("close", 175.50);
    }


    @Test
    void getHistory_shouldReturn30DaysBars() throws Exception {
        String barsJson = "[{\"o\":150.0,\"h\":155.0,\"l\":149.0,\"c\":153.5}]";
        JsonNode bars = objectMapper.readTree(barsJson);
        when(marketDataService.getHistory("AAPL", 30)).thenReturn(bars);

        ResponseEntity<JsonNode> response = controller.getHistory("AAPL", 30);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().isArray()).isTrue();
    }


    @Test
    void batchQuotes_shouldReturnMultipleTickers() {
        Map<String, Object> batchResult = Map.of(
                "AAPL", Map.of("ticker", "AAPL", "close", 175.50),
                "MSFT", Map.of("ticker", "MSFT", "close", 420.30));
        when(marketDataService.getBatchQuotes(List.of("AAPL", "MSFT"))).thenReturn(batchResult);

        ResponseEntity<Map<String, Object>> response = controller.getBatchQuotes(List.of("AAPL", "MSFT"));

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).containsKey("AAPL");
        assertThat(response.getBody()).containsKey("MSFT");
    }


    @Test
    void invalidTicker_shouldPropagateException() {
        when(marketDataService.getQuote("TOOLONG"))
                .thenThrow(new IllegalArgumentException("Invalid ticker symbol: TOOLONG"));

        assertThatThrownBy(() -> controller.getQuote("TOOLONG"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid ticker");
    }
}
