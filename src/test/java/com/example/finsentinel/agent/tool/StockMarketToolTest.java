package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.MarketDataService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class StockMarketToolTest {

    @Mock private MarketDataService marketDataService;

    private StockMarketTool stockMarketTool;

    @BeforeEach
    void setUp() {
        stockMarketTool = new StockMarketTool(marketDataService);
    }

    @Test
    void getStockQuote_shouldDelegateToMarketDataService() {
        String expected = """
                Stock Quote for AAPL:
                - Close: $175.50
                - Open: $176.00
                - High: $178.00
                - Low: $174.20
                - Volume: 52345678
                - Data as of: 2026-02-17""";
        when(marketDataService.getQuoteText("AAPL")).thenReturn(expected);

        String result = stockMarketTool.getStockQuote("AAPL");

        assertThat(result).isEqualTo(expected);
        verify(marketDataService).getQuoteText("AAPL");
    }

    @Test
    void getStockQuote_shouldReturnErrorMessageOnFailure() {
        when(marketDataService.getQuoteText("BAD"))
                .thenThrow(new IllegalArgumentException("Invalid ticker symbol: BAD"));

        String result = stockMarketTool.getStockQuote("BAD");

        assertThat(result).contains("Error fetching stock data for BAD");
        assertThat(result).contains("Invalid ticker");
    }

    @Test
    void getHistoricalPrices_shouldDelegateToMarketDataService() {
        String expected = "[{\"o\":150.0,\"h\":155.0,\"l\":149.0,\"c\":153.5}]";
        when(marketDataService.getHistoryJson("AAPL", 30)).thenReturn(expected);

        String result = stockMarketTool.getHistoricalPrices("AAPL", 30);

        assertThat(result).isEqualTo(expected);
        verify(marketDataService).getHistoryJson("AAPL", 30);
    }

    @Test
    void getHistoricalPrices_shouldReturnErrorMessageOnFailure() {
        when(marketDataService.getHistoryJson("BAD", 10))
                .thenThrow(new RuntimeException("No data"));

        String result = stockMarketTool.getHistoricalPrices("BAD", 10);

        assertThat(result).contains("Error fetching historical data for BAD");
    }
}
