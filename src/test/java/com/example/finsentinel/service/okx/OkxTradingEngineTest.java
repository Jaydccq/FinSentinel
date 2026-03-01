package com.example.finsentinel.service.okx;

import com.example.finsentinel.service.okx.dto.*;
import com.example.finsentinel.service.trading.engine.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link OkxTradingEngine}.
 * Uses Mockito to stub {@link OkxApiClient} — no live OKX credentials required.
 */
@ExtendWith(MockitoExtension.class)
class OkxTradingEngineTest {

    @Mock
    private OkxApiClient okxApiClient;

    @InjectMocks
    private OkxTradingEngine engine;

    // ── engineName ──────────────────────────────────────────────────────

    @Test
    void engineName_returnsOkx() {
        assertThat(engine.engineName()).isEqualTo("crypto-okx");
    }

    // ── getMarketClock ──────────────────────────────────────────────────

    @Test
    void getMarketClock_alwaysOpen() {
        MarketClock clock = engine.getMarketClock();

        assertThat(clock.isOpen()).isTrue();
        assertThat(clock.nextOpen()).isNull();
        assertThat(clock.nextClose()).isNull();
        assertThat(clock.timestamp()).isNotNull();
    }

    // ── getPositions ────────────────────────────────────────────────────

    @Test
    void getPositions_mapsOkxPositionsToPositionInfo() {
        OkxPosition okxPos = new OkxPosition(
                "BTC-USDT-SWAP", "SWAP", "long",
                "0.5",       // pos
                "42000.00",  // avgPx
                "43000.00",  // markPx
                "55000.00",  // liqPx
                "500.00",    // upl
                "0.023",     // uplRatio
                "10",        // lever
                "cross",     // mgnMode
                "2100.00",   // margin
                "2100.00",   // imr
                "210.00",    // mmr
                "21500.00",  // notionalUsd
                "43100.00",  // last
                "1700000000000", // cTime
                "1700000001000"  // uTime
        );

        when(okxApiClient.getPositions())
                .thenReturn(new OkxResponse<>("0", "", List.of(okxPos)));

        List<PositionInfo> positions = engine.getPositions();

        assertThat(positions).hasSize(1);
        PositionInfo p = positions.getFirst();
        assertThat(p.symbol()).isEqualTo("BTC-USDT-SWAP");
        assertThat(p.side()).isEqualTo("long");
        assertThat(p.qty()).isEqualByComparingTo("0.5");
        assertThat(p.avgEntryPrice()).isEqualByComparingTo("42000.00");
        assertThat(p.currentPrice()).isEqualByComparingTo("43000.00");
        assertThat(p.unrealizedPnL()).isEqualByComparingTo("500.00");
    }

    @Test
    void getPositions_filtersZeroSizePositions() {
        OkxPosition zeroPos = new OkxPosition(
                "ETH-USDT", "SPOT", "long",
                "0", "1800.00", "1850.00", null, "0", "0",
                "1", "cash", "0", "0", "0", "0", "1850.00",
                "1700000000000", "1700000000000"
        );

        when(okxApiClient.getPositions())
                .thenReturn(new OkxResponse<>("0", "", List.of(zeroPos)));

        List<PositionInfo> positions = engine.getPositions();

        assertThat(positions).isEmpty();
    }

    @Test
    void getPositions_returnsEmptyOnApiError() {
        when(okxApiClient.getPositions())
                .thenReturn(new OkxResponse<>("1", "Rate limit exceeded", List.of()));

        List<PositionInfo> positions = engine.getPositions();

        assertThat(positions).isEmpty();
    }

    // ── getAccount ──────────────────────────────────────────────────────

    @Test
    void getAccount_mapsOkxBalanceToAccountInfo() {
        OkxAccountBalance.BalanceDetail detail = new OkxAccountBalance.BalanceDetail(
                "USDT", "50000.00", "48000.00", "45000.00", "3000.00",
                "250.00", "0", "0", "", "50000.00"
        );
        OkxAccountBalance balance = new OkxAccountBalance(
                "50000.00", // totalEq
                "0",        // isoEq
                "49000.00", // adjEq
                "1000.00",  // ordFroz
                "5000.00",  // imr
                "500.00",   // mmr
                "",         // mgnRatio
                "50000.00", // notionalUsd
                List.of(detail)
        );

        when(okxApiClient.getBalance())
                .thenReturn(new OkxResponse<>("0", "", List.of(balance)));

        AccountInfo account = engine.getAccount();

        assertThat(account.equity()).isEqualByComparingTo("50000.00");
        // available = equity - imr = 50000 - 5000 = 45000
        assertThat(account.cash()).isEqualByComparingTo("45000.00");
        assertThat(account.buyingPower()).isEqualByComparingTo("45000.00");
        assertThat(account.unrealizedPnL()).isEqualByComparingTo("250.00");
    }

    @Test
    void getAccount_returnsZeroOnApiError() {
        when(okxApiClient.getBalance())
                .thenReturn(new OkxResponse<>("1", "Unauthorized", List.of()));

        AccountInfo account = engine.getAccount();

        assertThat(account.equity()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(account.cash()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    // ── placeOrder ──────────────────────────────────────────────────────

    @Test
    void placeOrder_marketBuy_delegatesToOkxApi() {
        OkxOrder filledOrder = new OkxOrder(
                "BTC-USDT", "12345", null, "buy", "market", "",
                "0.01", "", "42500.00", "0.01", "filled", "cash",
                "1", "-0.42", "0", "1700000000000", "1700000001000"
        );

        when(okxApiClient.placeOrder(anyMap()))
                .thenReturn(new OkxResponse<>("0", "", List.of(filledOrder)));

        OrderRequest request = new OrderRequest(
                "BTC-USDT", "buy", "market",
                new BigDecimal("0.01"), null, null, null, null, false
        );

        OrderResult result = engine.placeOrder(request);

        assertThat(result.success()).isTrue();
        assertThat(result.orderId()).isEqualTo("12345");
        assertThat(result.status()).isEqualTo("filled");
        assertThat(result.filledPrice()).isEqualByComparingTo("42500.00");
        assertThat(result.filledQty()).isEqualByComparingTo("0.01");

        verify(okxApiClient).placeOrder(anyMap());
    }

    @Test
    void placeOrder_apiError_returnsFalseWithMessage() {
        when(okxApiClient.placeOrder(anyMap()))
                .thenReturn(new OkxResponse<>("51000", "Parameter instId error", List.of()));

        OrderRequest request = new OrderRequest(
                "INVALID", "buy", "market",
                BigDecimal.ONE, null, null, null, null, false
        );

        OrderResult result = engine.placeOrder(request);

        assertThat(result.success()).isFalse();
        assertThat(result.status()).isEqualTo("rejected");
        assertThat(result.error()).isEqualTo("Parameter instId error");
    }

    @Test
    void placeOrder_futuresSymbol_usesCrossMargin() {
        OkxOrder order = new OkxOrder(
                "BTC-USDT-SWAP", "99999", null, "buy", "market", "",
                "1", "", "42500.00", "1", "filled", "cross",
                "10", "-0.42", "0", "1700000000000", "1700000001000"
        );

        when(okxApiClient.placeOrder(anyMap()))
                .thenReturn(new OkxResponse<>("0", "", List.of(order)));

        OrderRequest request = new OrderRequest(
                "BTC-USDT-SWAP", "buy", "market",
                BigDecimal.ONE, null, null, null, null, false
        );

        engine.placeOrder(request);

        @SuppressWarnings("unchecked")
        var captor = org.mockito.ArgumentCaptor.forClass(java.util.Map.class);
        verify(okxApiClient).placeOrder(captor.capture());

        assertThat(captor.getValue().get("tdMode")).isEqualTo("cross");
    }

    @Test
    void placeOrder_spotSymbol_usesCashMode() {
        OkxOrder order = new OkxOrder(
                "BTC-USDT", "88888", null, "buy", "market", "",
                "0.01", "", "42500.00", "0.01", "filled", "cash",
                "1", "0", "0", "1700000000000", "1700000001000"
        );

        when(okxApiClient.placeOrder(anyMap()))
                .thenReturn(new OkxResponse<>("0", "", List.of(order)));

        OrderRequest request = new OrderRequest(
                "BTC-USDT", "buy", "market",
                new BigDecimal("0.01"), null, null, null, null, false
        );

        engine.placeOrder(request);

        @SuppressWarnings("unchecked")
        var captor = org.mockito.ArgumentCaptor.forClass(java.util.Map.class);
        verify(okxApiClient).placeOrder(captor.capture());

        assertThat(captor.getValue().get("tdMode")).isEqualTo("cash");
    }

    // ── cancelOrder ─────────────────────────────────────────────────────

    @Test
    void cancelOrder_findsInstIdAndCancels() {
        OkxOrder pendingOrder = new OkxOrder(
                "ETH-USDT", "ord-001", null, "buy", "limit", "",
                "1", "1800.00", "", "", "live", "cash",
                "1", "0", "0", "1700000000000", "1700000000000"
        );

        when(okxApiClient.getPendingOrders())
                .thenReturn(new OkxResponse<>("0", "", List.of(pendingOrder)));
        when(okxApiClient.cancelOrder("ETH-USDT", "ord-001"))
                .thenReturn(new OkxResponse<>("0", "", List.of()));

        boolean result = engine.cancelOrder("ord-001");

        assertThat(result).isTrue();
        verify(okxApiClient).cancelOrder("ETH-USDT", "ord-001");
    }

    @Test
    void cancelOrder_orderNotFound_returnsFalse() {
        when(okxApiClient.getPendingOrders())
                .thenReturn(new OkxResponse<>("0", "", List.of()));

        boolean result = engine.cancelOrder("nonexistent-id");

        assertThat(result).isFalse();
        verify(okxApiClient, never()).cancelOrder(anyString(), anyString());
    }

    // ── getOrders ───────────────────────────────────────────────────────

    @Test
    void getOrders_mapsPendingOrders() {
        OkxOrder pending = new OkxOrder(
                "SOL-USDT", "ord-100", null, "sell", "limit", "",
                "10", "120.00", "", "0", "live", "cash",
                "1", "0", "0", "1700000000000", "1700000000000"
        );

        when(okxApiClient.getPendingOrders())
                .thenReturn(new OkxResponse<>("0", "", List.of(pending)));

        List<OrderResult> orders = engine.getOrders();

        assertThat(orders).hasSize(1);
        assertThat(orders.getFirst().orderId()).isEqualTo("ord-100");
        assertThat(orders.getFirst().status()).isEqualTo("pending");
    }

    // ── safeBigDecimal ──────────────────────────────────────────────────

    @Test
    void safeBigDecimal_parsesValidString() {
        assertThat(OkxTradingEngine.safeBigDecimal("42000.50"))
                .isEqualByComparingTo("42000.50");
    }

    @Test
    void safeBigDecimal_returnsZeroOnNull() {
        assertThat(OkxTradingEngine.safeBigDecimal(null))
                .isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    void safeBigDecimal_returnsZeroOnEmpty() {
        assertThat(OkxTradingEngine.safeBigDecimal(""))
                .isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    void safeBigDecimal_returnsZeroOnInvalid() {
        assertThat(OkxTradingEngine.safeBigDecimal("not-a-number"))
                .isEqualByComparingTo(BigDecimal.ZERO);
    }
}
