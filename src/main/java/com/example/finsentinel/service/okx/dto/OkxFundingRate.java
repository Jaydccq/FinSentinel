package com.example.finsentinel.service.okx.dto;

/**
 * Funding rate for perpetual swaps.
 *
 * <p>Maps to OKX v5 {@code /api/v5/public/funding-rate} response.
 */
public record OkxFundingRate(
        String instId,
        String instType,
        String fundingRate,
        String nextFundingRate,
        String fundingTime,
        String nextFundingTime
) {}
