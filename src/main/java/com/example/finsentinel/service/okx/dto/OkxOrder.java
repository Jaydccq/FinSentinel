package com.example.finsentinel.service.okx.dto;

/**
 * Order details.
 *
 * <p>Maps to OKX v5 {@code /api/v5/trade/order} response.
 */
public record OkxOrder(
        String instId,
        String ordId,
        String clOrdId,
        String side,
        String ordType,
        String posSide,
        String sz,
        String px,
        String avgPx,
        String accFillSz,
        String state,
        String tdMode,
        String lever,
        String fee,
        String pnl,
        String cTime,
        String uTime
) {}
