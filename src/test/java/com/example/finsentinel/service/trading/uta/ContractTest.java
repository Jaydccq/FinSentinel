package com.example.finsentinel.service.trading.uta;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ContractTest {

    @Test
    void stockContract_createdWithMinimalFields() {
        Contract contract = Contract.stock("AAPL");

        assertThat(contract.symbol()).isEqualTo("AAPL");
        assertThat(contract.secType()).isEqualTo(SecurityType.STOCK);
        assertThat(contract.exchange()).isEqualTo("SMART");
        assertThat(contract.currency()).isEqualTo("USD");
        assertThat(contract.expiry()).isNull();
        assertThat(contract.strike()).isNull();
        assertThat(contract.right()).isNull();
        assertThat(contract.multiplier()).isNull();
    }

    @Test
    void cryptoPerpContract_includesExchange() {
        Contract contract = Contract.cryptoPerp("BTC", "USDT", "OKX");

        assertThat(contract.symbol()).isEqualTo("BTC");
        assertThat(contract.secType()).isEqualTo(SecurityType.PERP);
        assertThat(contract.exchange()).isEqualTo("OKX");
        assertThat(contract.currency()).isEqualTo("USDT");
        assertThat(contract.secType().isCrypto()).isTrue();
    }

    @Test
    void cryptoSpotContract_forCcxtExchanges() {
        Contract contract = Contract.cryptoSpot("BTC", "USD", "BINANCE");

        assertThat(contract.symbol()).isEqualTo("BTC");
        assertThat(contract.secType()).isEqualTo(SecurityType.CRYPTO);
        assertThat(contract.exchange()).isEqualTo("BINANCE");
        assertThat(contract.currency()).isEqualTo("USD");
        assertThat(contract.secType().isCrypto()).isTrue();
    }

    @Test
    void toEngineSymbol_convertsToNativeFormat() {
        assertThat(Contract.stock("AAPL").toEngineSymbol())
                .isEqualTo("AAPL");

        assertThat(Contract.cryptoPerp("BTC", "USDT", "OKX").toEngineSymbol())
                .isEqualTo("BTC-USDT-SWAP");

        assertThat(Contract.cryptoSpot("BTC", "USD", "BINANCE").toEngineSymbol())
                .isEqualTo("BTC/USD");
    }

    @Test
    void fromString_parsesNaturalLanguageSymbols() {
        // Plain ticker → STOCK
        Contract stock = Contract.fromString("AAPL");
        assertThat(stock.secType()).isEqualTo(SecurityType.STOCK);
        assertThat(stock.symbol()).isEqualTo("AAPL");

        // OKX perpetual → PERP
        Contract perp = Contract.fromString("BTC-USDT-SWAP");
        assertThat(perp.secType()).isEqualTo(SecurityType.PERP);
        assertThat(perp.symbol()).isEqualTo("BTC");
        assertThat(perp.currency()).isEqualTo("USDT");

        // CCXT slash format → CRYPTO
        Contract spot = Contract.fromString("BTC/USD");
        assertThat(spot.secType()).isEqualTo(SecurityType.CRYPTO);
        assertThat(spot.symbol()).isEqualTo("BTC");
        assertThat(spot.currency()).isEqualTo("USD");

        // Dash format without SWAP → CRYPTO
        Contract dashSpot = Contract.fromString("ETH-USDT");
        assertThat(dashSpot.secType()).isEqualTo(SecurityType.CRYPTO);
        assertThat(dashSpot.symbol()).isEqualTo("ETH");
        assertThat(dashSpot.currency()).isEqualTo("USDT");
    }

    @Test
    void displayName_humanReadable() {
        assertThat(Contract.stock("AAPL").displayName())
                .isEqualTo("AAPL (Stock)");

        assertThat(Contract.cryptoPerp("BTC", "USDT", "OKX").displayName())
                .isEqualTo("BTC-USDT Perp @OKX");
    }

    @Test
    void fromString_rejectsBlankInput() {
        assertThatThrownBy(() -> Contract.fromString(""))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("blank");
        assertThatThrownBy(() -> Contract.fromString("   "))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("blank");
    }

    @Test
    void fromString_detectsForexPairs() {
        // Both sides are fiat currencies → FOREX, not CRYPTO
        assertThat(Contract.fromString("EUR-USD").secType()).isEqualTo(SecurityType.FOREX);
        assertThat(Contract.fromString("GBP/JPY").secType()).isEqualTo(SecurityType.FOREX);
        assertThat(Contract.fromString("USD-CAD").secType()).isEqualTo(SecurityType.FOREX);

        // One side is crypto → still CRYPTO
        assertThat(Contract.fromString("BTC-USD").secType()).isEqualTo(SecurityType.CRYPTO);
        assertThat(Contract.fromString("ETH/USDT").secType()).isEqualTo(SecurityType.CRYPTO);
    }

    @Test
    void equality_basedOnCanonicalFields() {
        Contract a = Contract.stock("AAPL");
        Contract b = Contract.stock("AAPL");

        assertThat(a).isEqualTo(b);
        assertThat(a.hashCode()).isEqualTo(b.hashCode());

        // Case and whitespace should be normalized
        Contract c = Contract.stock("  aapl  ");
        assertThat(a).isEqualTo(c);
    }
}
