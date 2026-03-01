package com.example.finsentinel.service.okx.dto;

/**
 * Position info including liquidation price and leverage.
 *
 * <p>Maps to OKX v5 {@code /api/v5/account/positions} response.
 */
public record OkxPosition(
        String instId,
        String instType,
        String posSide,
        String pos,
        String avgPx,
        String markPx,
        String liqPx,
        String upl,
        String uplRatio,
        String lever,
        String mgnMode,
        String margin,
        String imr,
        String mmr,
        String notionalUsd,
        String last,
        String cTime,
        String uTime
) {}
