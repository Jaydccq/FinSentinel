package com.example.finsentinel.service.trading.uta;

public enum SecurityType {
    STOCK,    // Equities (Alpaca, Paper)
    OPTION,   // Equity options (future: IBKR)
    FUTURE,   // Commodity/index futures (future: IBKR)
    CRYPTO,   // Crypto spot (CCXT exchanges)
    PERP,     // Crypto perpetual swap (OKX)
    FOREX;    // Foreign exchange (future: IBKR)

    public boolean isCrypto() {
        return this == CRYPTO || this == PERP;
    }
}
