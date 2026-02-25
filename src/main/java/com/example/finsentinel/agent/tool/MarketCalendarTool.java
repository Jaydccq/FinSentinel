package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.market.MarketCalendarService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@Slf4j
public class MarketCalendarTool {

    private final MarketCalendarService calendarService;

    @Tool(description = "Get upcoming earnings dates and estimates for a stock. "
            + "Shows report date, EPS estimates, and revenue forecasts. "
            + "Use before earnings season to assess event-driven risk.")
    public String getUpcomingEarnings(
            @ToolParam(description = "Stock ticker symbol, e.g. AAPL") String ticker) {
        return calendarService.getUpcomingEarnings(ticker);
    }

    @Tool(description = "Get dividend calendar and history for a stock. "
            + "Shows ex-dividend dates, payment dates, and dividend amounts. "
            + "Use for income analysis and dividend capture strategy.")
    public String getDividendHistory(
            @ToolParam(description = "Stock ticker symbol, e.g. MSFT") String ticker) {
        return calendarService.getDividendHistory(ticker);
    }

    @Tool(description = "Get stock split history for a ticker. "
            + "Shows historical split events with ratios and dates.")
    public String getSplitHistory(
            @ToolParam(description = "Stock ticker symbol, e.g. TSLA") String ticker) {
        return calendarService.getSplitHistory(ticker);
    }

    @Tool(description = "Get upcoming IPO calendar showing companies about to go public. "
            + "Shows expected date, price range, and underwriters.")
    public String getIPOCalendar() {
        return calendarService.getIPOCalendar();
    }
}
