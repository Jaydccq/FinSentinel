package com.example.finsentinel.service.trading.engine;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link AlpacaTradingEngine}.
 *
 * <p>Full integration tests require an Alpaca paper-trading sandbox.
 * These tests verify construction and basic invariants only.
 */
class AlpacaTradingEngineTest {

    @Test
    void engineName_returnsAlpaca() {
        assertThat(new AlpacaTradingEngine(null, null, "https://paper-api.alpaca.markets")
                .engineName()).isEqualTo("alpaca");
    }

    @Test
    void constructor_usesDefaultBaseUrlWhenNull() {
        // Should not throw — null baseUrl defaults to paper-api
        AlpacaTradingEngine engine = new AlpacaTradingEngine("key", "secret", null);
        assertThat(engine.engineName()).isEqualTo("alpaca");
    }

    @Test
    void getAccount_returnsSafeDefaultOnError() {
        // With invalid credentials, getAccount should return zeroed AccountInfo (not throw)
        AlpacaTradingEngine engine = new AlpacaTradingEngine("bad", "bad", "http://localhost:1");
        AccountInfo account = engine.getAccount();
        assertThat(account).isNotNull();
        assertThat(account.cash()).isNotNull();
    }

    @Test
    void getPositions_returnsEmptyListOnError() {
        AlpacaTradingEngine engine = new AlpacaTradingEngine("bad", "bad", "http://localhost:1");
        assertThat(engine.getPositions()).isEmpty();
    }

    @Test
    void getOrders_returnsEmptyListOnError() {
        AlpacaTradingEngine engine = new AlpacaTradingEngine("bad", "bad", "http://localhost:1");
        assertThat(engine.getOrders()).isEmpty();
    }

    @Test
    void cancelOrder_returnsFalseOnError() {
        AlpacaTradingEngine engine = new AlpacaTradingEngine("bad", "bad", "http://localhost:1");
        assertThat(engine.cancelOrder("nonexistent")).isFalse();
    }

    @Test
    void placeOrder_returnsFailedResultOnError() {
        AlpacaTradingEngine engine = new AlpacaTradingEngine("bad", "bad", "http://localhost:1");
        OrderRequest request = new OrderRequest(
                "AAPL", "buy", "market", null, null, null, null, "day", false
        );
        OrderResult result = engine.placeOrder(request);
        assertThat(result.success()).isFalse();
        assertThat(result.status()).isEqualTo("rejected");
        assertThat(result.error()).isNotNull();
    }

    @Test
    void syncOrders_returnsEmptyListOnError() {
        AlpacaTradingEngine engine = new AlpacaTradingEngine("bad", "bad", "http://localhost:1");
        assertThat(engine.syncOrders()).isEmpty();
    }

    @Test
    void getMarketClock_returnsClosedOnError() {
        AlpacaTradingEngine engine = new AlpacaTradingEngine("bad", "bad", "http://localhost:1");
        MarketClock clock = engine.getMarketClock();
        assertThat(clock.isOpen()).isFalse();
        assertThat(clock.timestamp()).isNotNull();
    }
}
