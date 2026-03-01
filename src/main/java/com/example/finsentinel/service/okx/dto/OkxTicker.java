package com.example.finsentinel.service.okx.dto;

/**
 * Market ticker data.
 *
 * <p>Maps to OKX v5 {@code /api/v5/market/ticker} response.
 */
public record OkxTicker(
        String instId,
        String instType,
        String last,
        String lastSz,
        String askPx,
        String askSz,
        String bidPx,
        String bidSz,
        String open24h,
        String high24h,
        String low24h,
        String vol24h,
        String volCcy24h,
        String ts
) {}
