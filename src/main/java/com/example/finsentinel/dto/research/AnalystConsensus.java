package com.example.finsentinel.dto.research;

import java.math.BigDecimal;

/**
 * Analyst consensus data computed from available financial metrics.
 *
 * <p>Since Polygon.io does not provide analyst consensus data, this record
 * holds heuristic-based estimates derived from PE ratio, revenue growth, and
 * current price. The {@code computationNote} field always discloses that
 * these are computed values rather than real analyst opinions.
 *
 * @param ticker            stock ticker symbol
 * @param recommendation    rating: STRONG_BUY, BUY, HOLD, SELL, or STRONG_SELL
 * @param targetPriceHigh   high end of computed target price range
 * @param targetPriceLow    low end of computed target price range
 * @param targetPriceMedian median computed target price
 * @param currentPrice      current market price
 * @param upsidePotential   percentage upside from current to median target
 * @param computationNote   disclosure that values are computed estimates
 */
public record AnalystConsensus(
        String ticker,
        String recommendation,
        BigDecimal targetPriceHigh,
        BigDecimal targetPriceLow,
        BigDecimal targetPriceMedian,
        BigDecimal currentPrice,
        BigDecimal upsidePotential,
        String computationNote
) {}
