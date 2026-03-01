package com.example.finsentinel.service.okx.dto;

import java.util.List;

/**
 * Account balance with per-currency details.
 *
 * <p>Maps to OKX v5 {@code /api/v5/account/balance} response.
 */
public record OkxAccountBalance(
        String totalEq,
        String isoEq,
        String adjEq,
        String ordFroz,
        String imr,
        String mmr,
        String mgnRatio,
        String notionalUsd,
        List<BalanceDetail> details
) {
    public record BalanceDetail(
            String ccy,
            String eq,
            String cashBal,
            String availBal,
            String frozenBal,
            String upl,
            String crossLiab,
            String isoLiab,
            String mgnRatio,
            String disEq
    ) {}
}
