package com.example.finsentinel.dto.scraper;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * Request body for SEC filings and news scraper endpoints.
 *
 * @param tickers list of ticker symbols to scrape (1-20 tickers)
 * @param days number of days to look back for news (1-90, default 7)
 */
public record TickerScrapeRequest(
        @Size(min = 1, max = 20, message = "tickers list must contain 1-20 symbols")
        List<String> tickers,

        @Min(1) @Max(90)
        Integer days
) {
    public List<String> resolvedTickers() {
        return tickers != null && !tickers.isEmpty()
                ? tickers
                : List.of("AAPL", "MSFT", "GOOGL", "TSLA", "JPM");
    }

    public int resolvedDays() {
        return days != null ? days : 7;
    }
}
