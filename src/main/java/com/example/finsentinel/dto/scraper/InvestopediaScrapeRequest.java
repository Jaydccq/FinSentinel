package com.example.finsentinel.dto.scraper;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * Request body for the Investopedia scraper endpoint.
 *
 * @param maxTerms maximum number of terms to scrape (1-500, default 50)
 */
public record InvestopediaScrapeRequest(
        @Min(1) @Max(500)
        Integer maxTerms
) {
    public int resolvedMaxTerms() {
        return maxTerms != null ? maxTerms : 50;
    }
}
