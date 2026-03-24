package com.example.finsentinel.service.trading.uta;

import java.math.BigDecimal;

/**
 * A staged trade operation in the UTA system.
 * Replaces TradeOperation with Contract-aware identification.
 *
 * @param action   "BUY", "SELL", or "CLOSE"
 * @param contract the asset to trade (replaces raw ticker)
 * @param qty      number of shares/contracts (alternative to notional)
 * @param notional dollar amount (alternative to qty)
 * @param price    limit price, null for market order
 */
public record UnifiedTradeOperation(
        String action,
        Contract contract,
        BigDecimal qty,
        BigDecimal notional,
        BigDecimal price
) {
    /**
     * Backwards-compatible conversion from legacy ticker-based staging.
     */
    public static UnifiedTradeOperation fromLegacy(String action, String ticker,
                                                    BigDecimal shares, BigDecimal amount,
                                                    BigDecimal price) {
        return new UnifiedTradeOperation(action, Contract.fromString(ticker),
                shares, amount, price);
    }

    /**
     * Convenience: extract ticker for display/logging.
     */
    public String ticker() {
        return contract.toEngineSymbol();
    }
}
