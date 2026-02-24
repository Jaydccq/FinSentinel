package com.example.finsentinel.service.trading.engine;

import com.example.finsentinel.service.MarketDataService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link PaperTradingEngine} verifying simulated buy/sell
 * execution, cash management, position tracking, and edge cases.
 */
@ExtendWith(MockitoExtension.class)
class PaperTradingEngineTest {

    @Mock
    private MarketDataService marketDataService;

    private PaperTradingEngine engine;

    private static final BigDecimal INITIAL_CASH = new BigDecimal("100000.00");

    @BeforeEach
    void setUp() {
        engine = new PaperTradingEngine(marketDataService, INITIAL_CASH);
    }

    @Test
    void placeOrder_buyMarket_reducesCashAndAddsPosition() {
        when(marketDataService.getQuote("AAPL"))
                .thenReturn(Map.of("close", 150.0));

        OrderRequest buy = new OrderRequest(
                "AAPL", "buy", "market",
                new BigDecimal("10"),   // qty
                null,                   // notional
                null,                   // price
                null,                   // stopPrice
                "day",                  // timeInForce
                false                   // reduceOnly
        );

        OrderResult result = engine.placeOrder(buy);

        assertThat(result.success()).isTrue();
        assertThat(result.status()).isEqualTo("filled");
        assertThat(result.filledPrice()).isEqualByComparingTo(new BigDecimal("150"));
        assertThat(result.filledQty()).isEqualByComparingTo(new BigDecimal("10"));

        // Cash should be reduced by 10 * $150 = $1,500
        assertThat(engine.getCash())
                .isEqualByComparingTo(new BigDecimal("98500.00"));

        // Position should exist
        List<PositionInfo> positions = engine.getPositions();
        assertThat(positions).hasSize(1);

        PositionInfo pos = positions.get(0);
        assertThat(pos.symbol()).isEqualTo("AAPL");
        assertThat(pos.qty()).isEqualByComparingTo(new BigDecimal("10"));
        assertThat(pos.avgEntryPrice()).isEqualByComparingTo(new BigDecimal("150"));
    }

    @Test
    void placeOrder_sellWithPosition_increasesCash() {
        when(marketDataService.getQuote("AAPL"))
                .thenReturn(Map.of("close", 150.0));

        // First buy 10 shares
        OrderRequest buy = new OrderRequest(
                "AAPL", "buy", "market",
                new BigDecimal("10"), null, null, null, "day", false);
        engine.placeOrder(buy);

        // Now sell 4 shares (partial sell)
        OrderRequest sell = new OrderRequest(
                "AAPL", "sell", "market",
                new BigDecimal("4"), null, null, null, "day", false);
        OrderResult sellResult = engine.placeOrder(sell);

        assertThat(sellResult.success()).isTrue();
        assertThat(sellResult.status()).isEqualTo("filled");
        assertThat(sellResult.filledQty()).isEqualByComparingTo(new BigDecimal("4"));

        // Cash: started at 100000, bought 10 * 150 = -1500, sold 4 * 150 = +600
        // 100000 - 1500 + 600 = 99100
        assertThat(engine.getCash())
                .isEqualByComparingTo(new BigDecimal("99100.00"));

        // Should have 6 remaining shares
        List<PositionInfo> positions = engine.getPositions();
        assertThat(positions).hasSize(1);
        assertThat(positions.get(0).qty()).isEqualByComparingTo(new BigDecimal("6"));
    }

    @Test
    void placeOrder_insufficientFunds_fails() {
        when(marketDataService.getQuote("AAPL"))
                .thenReturn(Map.of("close", 150.0));

        // Try to buy 1000 shares at $150 each = $150,000 (more than $100,000 cash)
        OrderRequest buy = new OrderRequest(
                "AAPL", "buy", "market",
                new BigDecimal("1000"), null, null, null, "day", false);

        OrderResult result = engine.placeOrder(buy);

        assertThat(result.success()).isFalse();
        assertThat(result.status()).isEqualTo("rejected");
        assertThat(result.error()).contains("Insufficient funds");

        // Cash should be unchanged
        assertThat(engine.getCash()).isEqualByComparingTo(INITIAL_CASH);

        // No positions
        assertThat(engine.getPositions()).isEmpty();
    }

    @Test
    void engineName_returnsPaper() {
        assertThat(engine.engineName()).isEqualTo("paper");
    }

    @Test
    void placeOrder_sellAll_removesPosition() {
        when(marketDataService.getQuote("AAPL"))
                .thenReturn(Map.of("close", 150.0));

        // Buy 10 shares
        engine.placeOrder(new OrderRequest(
                "AAPL", "buy", "market",
                new BigDecimal("10"), null, null, null, "day", false));

        // Sell all (qty=null, notional=null triggers sell-all)
        OrderRequest sellAll = new OrderRequest(
                "AAPL", "sell", "market",
                null, null, null, null, "day", false);
        OrderResult result = engine.placeOrder(sellAll);

        assertThat(result.success()).isTrue();
        assertThat(result.filledQty()).isEqualByComparingTo(new BigDecimal("10"));

        // Position should be fully closed
        assertThat(engine.getPositions()).isEmpty();

        // Cash should be restored to initial
        assertThat(engine.getCash()).isEqualByComparingTo(INITIAL_CASH);
    }

    @Test
    void placeOrder_sellNoPosition_fails() {
        when(marketDataService.getQuote("TSLA"))
                .thenReturn(Map.of("close", 250.0));

        OrderRequest sell = new OrderRequest(
                "TSLA", "sell", "market",
                new BigDecimal("5"), null, null, null, "day", false);

        OrderResult result = engine.placeOrder(sell);

        assertThat(result.success()).isFalse();
        assertThat(result.error()).contains("No position in TSLA");
    }

    @Test
    void placeOrder_buyWithNotional_calculatesShares() {
        when(marketDataService.getQuote("AAPL"))
                .thenReturn(Map.of("close", 150.0));

        // Buy $1500 worth of AAPL at $150 = 10 shares
        OrderRequest buy = new OrderRequest(
                "AAPL", "buy", "market",
                null, new BigDecimal("1500"), null, null, "day", false);

        OrderResult result = engine.placeOrder(buy);

        assertThat(result.success()).isTrue();
        assertThat(result.filledQty()).isEqualByComparingTo(new BigDecimal("10"));

        // Cash reduced by $1500
        assertThat(engine.getCash()).isEqualByComparingTo(new BigDecimal("98500.00"));
    }

    @Test
    void getAccount_reflectsCorrectValues() {
        when(marketDataService.getQuote("AAPL"))
                .thenReturn(Map.of("close", 150.0));

        engine.placeOrder(new OrderRequest(
                "AAPL", "buy", "market",
                new BigDecimal("10"), null, null, null, "day", false));

        AccountInfo account = engine.getAccount();

        assertThat(account.cash()).isEqualByComparingTo(new BigDecimal("98500.00"));
        assertThat(account.portfolioValue()).isEqualByComparingTo(new BigDecimal("1500.00"));
        assertThat(account.equity()).isEqualByComparingTo(INITIAL_CASH);
        assertThat(account.buyingPower()).isEqualByComparingTo(new BigDecimal("98500.00"));
    }

    @Test
    void cancelOrder_alwaysReturnsFalse() {
        assertThat(engine.cancelOrder("paper-1")).isFalse();
        assertThat(engine.cancelOrder("any-id")).isFalse();
    }

    @Test
    void getOrders_tracksOrderHistory() {
        when(marketDataService.getQuote("AAPL"))
                .thenReturn(Map.of("close", 150.0));

        engine.placeOrder(new OrderRequest(
                "AAPL", "buy", "market",
                new BigDecimal("10"), null, null, null, "day", false));
        engine.placeOrder(new OrderRequest(
                "AAPL", "sell", "market",
                new BigDecimal("5"), null, null, null, "day", false));

        List<OrderResult> orders = engine.getOrders();
        assertThat(orders).hasSize(2);
        assertThat(orders.get(0).success()).isTrue();
        assertThat(orders.get(1).success()).isTrue();
    }

    @Test
    void setCashAndSetPositions_restoreWalletState() {
        when(marketDataService.getQuote("AAPL"))
                .thenReturn(Map.of("close", 160.0));

        // Simulate restoring from wallet JSONB
        engine.setCash(new BigDecimal("85000.00"));
        engine.setPositions(List.of(
                Map.of("ticker", "AAPL",
                       "shares", new BigDecimal("100"),
                       "avgCost", new BigDecimal("150.00"))
        ));

        assertThat(engine.getCash()).isEqualByComparingTo(new BigDecimal("85000.00"));

        List<PositionInfo> positions = engine.getPositions();
        assertThat(positions).hasSize(1);
        assertThat(positions.get(0).symbol()).isEqualTo("AAPL");
        assertThat(positions.get(0).qty()).isEqualByComparingTo(new BigDecimal("100"));
        assertThat(positions.get(0).avgEntryPrice()).isEqualByComparingTo(new BigDecimal("150.00"));
        assertThat(positions.get(0).currentPrice()).isEqualByComparingTo(new BigDecimal("160"));
    }

    @Test
    void getPositionMaps_returnsDeepCopy() {
        when(marketDataService.getQuote("AAPL"))
                .thenReturn(Map.of("close", 150.0));

        engine.placeOrder(new OrderRequest(
                "AAPL", "buy", "market",
                new BigDecimal("10"), null, null, null, "day", false));

        List<Map<String, Object>> exported = engine.getPositionMaps();
        assertThat(exported).hasSize(1);
        assertThat(exported.get(0).get("ticker")).isEqualTo("AAPL");

        // Modifying the exported map should not affect the engine's internal state
        exported.get(0).put("ticker", "MODIFIED");
        assertThat(engine.getPositionMaps().get(0).get("ticker")).isEqualTo("AAPL");
    }

    @Test
    void placeOrder_buyThenBuy_calculatesWeightedAvgCost() {
        // First buy at $150
        when(marketDataService.getQuote("AAPL"))
                .thenReturn(Map.of("close", 150.0));
        engine.placeOrder(new OrderRequest(
                "AAPL", "buy", "market",
                new BigDecimal("10"), null, null, null, "day", false));

        // Second buy at $160
        when(marketDataService.getQuote("AAPL"))
                .thenReturn(Map.of("close", 160.0));
        engine.placeOrder(new OrderRequest(
                "AAPL", "buy", "market",
                new BigDecimal("10"), null, null, null, "day", false));

        List<PositionInfo> positions = engine.getPositions();
        assertThat(positions).hasSize(1);
        assertThat(positions.get(0).qty()).isEqualByComparingTo(new BigDecimal("20"));
        // Weighted avg: (10*150 + 10*160) / 20 = 3100/20 = 155
        assertThat(positions.get(0).avgEntryPrice()).isEqualByComparingTo(new BigDecimal("155"));
    }
}
