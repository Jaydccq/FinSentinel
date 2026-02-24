package com.example.finsentinel.service.trading.engine;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for CcxtTradingEngine.
 * Tests are designed to run without live exchange credentials.
 */
class CcxtTradingEngineTest {

    @Test
    void engineName_returnsCrypto() {
        assertThat(new CcxtTradingEngine("binance", null, null, true)
                .engineName()).isEqualTo("crypto-binance");
    }

    @Test
    void engineName_defaultsToBindance_whenNull() {
        assertThat(new CcxtTradingEngine(null, null, null, false)
                .engineName()).isEqualTo("crypto-binance");
    }

    @Test
    void engineName_lowercasesExchangeName() {
        assertThat(new CcxtTradingEngine("Kraken", null, null, false)
                .engineName()).isEqualTo("crypto-kraken");
    }

    @Test
    void placeOrder_returnsRejected_whenExchangeNull() {
        CcxtTradingEngine engine = new CcxtTradingEngine("binance", null, null, true);
        OrderRequest request = new OrderRequest("BTC/USD", "buy", "market",
                BigDecimal.ONE, null, null, null, null, false);

        OrderResult result = engine.placeOrder(request);

        assertThat(result.success()).isFalse();
        assertThat(result.status()).isEqualTo("rejected");
        assertThat(result.error()).isEqualTo("Exchange not initialized");
    }

    @Test
    void getPositions_returnsEmptyList_whenExchangeNull() {
        CcxtTradingEngine engine = new CcxtTradingEngine("binance", null, null, true);

        List<PositionInfo> positions = engine.getPositions();

        assertThat(positions).isEmpty();
    }

    @Test
    void getOrders_returnsEmptyList_whenExchangeNull() {
        CcxtTradingEngine engine = new CcxtTradingEngine("binance", null, null, true);

        List<OrderResult> orders = engine.getOrders();

        assertThat(orders).isEmpty();
    }

    @Test
    void getAccount_returnsZeroValues_whenExchangeNull() {
        CcxtTradingEngine engine = new CcxtTradingEngine("binance", null, null, true);

        AccountInfo account = engine.getAccount();

        assertThat(account.cash()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(account.portfolioValue()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(account.equity()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(account.buyingPower()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(account.unrealizedPnL()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(account.realizedPnL()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    void cancelOrder_returnsFalse_whenExchangeNull() {
        CcxtTradingEngine engine = new CcxtTradingEngine("binance", null, null, true);

        assertThat(engine.cancelOrder("some-order-id")).isFalse();
    }

    @Test
    void parsePair_splitOnSlash() {
        CcxtTradingEngine engine = new CcxtTradingEngine("binance", null, null, true);

        var pair = engine.parsePair("BTC/USD");

        assertThat(pair.base.getCurrencyCode()).isEqualTo("BTC");
        assertThat(pair.counter.getCurrencyCode()).isEqualTo("USD");
    }

    @Test
    void parsePair_defaultsToUsd_whenNoSlash() {
        CcxtTradingEngine engine = new CcxtTradingEngine("binance", null, null, true);

        var pair = engine.parsePair("ETH");

        assertThat(pair.base.getCurrencyCode()).isEqualTo("ETH");
        assertThat(pair.counter.getCurrencyCode()).isEqualTo("USD");
    }

    @Test
    void parsePair_handlesBlanks() {
        CcxtTradingEngine engine = new CcxtTradingEngine("binance", null, null, true);

        var pair = engine.parsePair("");

        assertThat(pair.base.getCurrencyCode()).isEqualTo("BTC");
        assertThat(pair.counter.getCurrencyCode()).isEqualTo("USD");
    }

    @Test
    void parsePair_handlesNull() {
        CcxtTradingEngine engine = new CcxtTradingEngine("binance", null, null, true);

        var pair = engine.parsePair(null);

        assertThat(pair.base.getCurrencyCode()).isEqualTo("BTC");
        assertThat(pair.counter.getCurrencyCode()).isEqualTo("USD");
    }

    @Test
    void parsePair_trimAndUppercase() {
        CcxtTradingEngine engine = new CcxtTradingEngine("binance", null, null, true);

        var pair = engine.parsePair(" sol / usdt ");

        assertThat(pair.base.getCurrencyCode()).isEqualTo("SOL");
        assertThat(pair.counter.getCurrencyCode()).isEqualTo("USDT");
    }
}
