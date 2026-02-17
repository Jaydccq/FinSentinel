package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.MarketDataService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

@Component
@Slf4j
@RequiredArgsConstructor
public class StockMarketTool {

    private final MarketDataService marketDataService;

    @Tool(description = "Get real-time stock market data for a given ticker symbol. " +
            "Returns current price, open, high, low, close, and volume. " +
            "Use this when you need current market data for risk assessment.")
    public String getStockQuote(
            @ToolParam(description = "Stock ticker symbol, e.g. AAPL, MSFT, TSLA") String ticker) {
        try {
            return marketDataService.getQuoteText(ticker);
        } catch (Exception e) {
            log.error("Failed to fetch stock quote for {}", ticker, e);
            return "Error fetching stock data for " + ticker + ": " + e.getMessage();
        }
    }

    @Tool(description = "Get historical stock price data (daily bars) for technical analysis. " +
            "Returns OHLCV bars for the specified number of days.")
    public String getHistoricalPrices(
            @ToolParam(description = "Stock ticker symbol") String ticker,
            @ToolParam(description = "Number of days of historical data (max 365)") int days) {
        try {
            return marketDataService.getHistoryJson(ticker, days);
        } catch (Exception e) {
            log.error("Failed to fetch history for {}", ticker, e);
            return "Error fetching historical data for " + ticker + ": " + e.getMessage();
        }
    }
}
