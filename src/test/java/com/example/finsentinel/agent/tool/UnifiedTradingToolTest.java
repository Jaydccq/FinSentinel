package com.example.finsentinel.agent.tool;

import com.example.finsentinel.repository.TradeWalletRepository;
import com.example.finsentinel.service.trading.uta.BrokerRegistry;
import com.example.finsentinel.service.trading.uta.Contract;
import com.example.finsentinel.service.trading.uta.SecurityType;
import com.example.finsentinel.service.trading.uta.UnifiedTradeOperation;
import com.example.finsentinel.service.trading.uta.UnifiedTradingService;
import com.example.finsentinel.util.SecurityUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class UnifiedTradingToolTest {

    private static final UUID TEST_USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private UnifiedTradingService tradingService;
    private BrokerRegistry brokerRegistry;
    private TradeWalletRepository tradeWalletRepository;
    private UnifiedTradingTool tool;

    private MockedStatic<SecurityUtils> securityUtilsMock;

    @BeforeEach
    void setUp() {
        tradingService = mock(UnifiedTradingService.class);
        brokerRegistry = mock(BrokerRegistry.class);
        tradeWalletRepository = mock(TradeWalletRepository.class);
        tool = new UnifiedTradingTool(tradingService, brokerRegistry, tradeWalletRepository);

        securityUtilsMock = mockStatic(SecurityUtils.class);
        securityUtilsMock.when(SecurityUtils::getCurrentUserId).thenReturn(TEST_USER_ID);
    }

    @AfterEach
    void tearDown() {
        securityUtilsMock.close();
    }

    // ── 1. stageOrder parses stock symbol ───────────────────────────────

    @Test
    void stageOrder_parsesStockSymbol() {
        when(tradingService.stage(eq(TEST_USER_ID), any(UnifiedTradeOperation.class)))
                .thenReturn("Staged: BUY 10 of AAPL (Stock) (1 operation staged)");

        String result = tool.stageOrder("BUY", "AAPL", "10", null, null);

        assertThat(result).contains("Staged");
        assertThat(result).contains("AAPL");

        ArgumentCaptor<UnifiedTradeOperation> captor = ArgumentCaptor.forClass(UnifiedTradeOperation.class);
        verify(tradingService).stage(eq(TEST_USER_ID), captor.capture());

        UnifiedTradeOperation captured = captor.getValue();
        assertThat(captured.action()).isEqualTo("BUY");
        assertThat(captured.contract().secType()).isEqualTo(SecurityType.STOCK);
        assertThat(captured.contract().symbol()).isEqualTo("AAPL");
        assertThat(captured.qty()).isEqualByComparingTo(new BigDecimal("10"));
        assertThat(captured.notional()).isNull();
        assertThat(captured.price()).isNull();
    }

    // ── 2. stageOrder parses crypto perp ────────────────────────────────

    @Test
    void stageOrder_parsesCryptoPerp() {
        when(tradingService.stage(eq(TEST_USER_ID), any(UnifiedTradeOperation.class)))
                .thenReturn("Staged: BUY 1 of BTC-USDT Perp @OKX (1 operation staged)");

        String result = tool.stageOrder("BUY", "BTC-USDT-SWAP", "1", null, null);

        assertThat(result).contains("Staged");

        ArgumentCaptor<UnifiedTradeOperation> captor = ArgumentCaptor.forClass(UnifiedTradeOperation.class);
        verify(tradingService).stage(eq(TEST_USER_ID), captor.capture());

        UnifiedTradeOperation captured = captor.getValue();
        assertThat(captured.action()).isEqualTo("BUY");
        assertThat(captured.contract().secType()).isEqualTo(SecurityType.PERP);
        assertThat(captured.contract().symbol()).isEqualTo("BTC");
        assertThat(captured.contract().currency()).isEqualTo("USDT");
        assertThat(captured.qty()).isEqualByComparingTo(BigDecimal.ONE);
    }

    // ── 3. stageOrder handles null qty — only amount provided ───────────

    @Test
    void stageOrder_handlesNullQtyAndAmount() {
        when(tradingService.stage(eq(TEST_USER_ID), any(UnifiedTradeOperation.class)))
                .thenReturn("Staged: BUY $5000 of AAPL (Stock) (1 operation staged)");

        String result = tool.stageOrder("BUY", "AAPL", null, "5000", null);

        assertThat(result).contains("Staged");

        ArgumentCaptor<UnifiedTradeOperation> captor = ArgumentCaptor.forClass(UnifiedTradeOperation.class);
        verify(tradingService).stage(eq(TEST_USER_ID), captor.capture());

        UnifiedTradeOperation captured = captor.getValue();
        assertThat(captured.qty()).isNull();
        assertThat(captured.notional()).isEqualByComparingTo(new BigDecimal("5000"));
        assertThat(captured.price()).isNull();
    }

    // ── 4. commitTrade delegates to service ─────────────────────────────

    @Test
    void commitTrade_delegatesToService() {
        String expectedResult = "Committed: abc123 -- Going long AAPL (1 operation). Call executeTrade to finalize.";
        when(tradingService.commit(TEST_USER_ID, "Going long AAPL"))
                .thenReturn(expectedResult);

        String result = tool.commitTrade("Going long AAPL");

        assertThat(result).isEqualTo(expectedResult);
        verify(tradingService).commit(TEST_USER_ID, "Going long AAPL");
    }

    // ── 5. executeTrade delegates to service ────────────────────────────

    @Test
    void executeTrade_delegatesToService() {
        String expectedResult = "=== Execution Report ===\nBroker: Paper Trading\n";
        when(tradingService.execute(TEST_USER_ID)).thenReturn(expectedResult);

        String result = tool.executeTrade();

        assertThat(result).isEqualTo(expectedResult);
        verify(tradingService).execute(TEST_USER_ID);
    }

    // ── Error handling ──────────────────────────────────────────────────

    @Test
    void stageOrder_returnsErrorOnException() {
        when(tradingService.stage(eq(TEST_USER_ID), any(UnifiedTradeOperation.class)))
                .thenThrow(new RuntimeException("Redis unavailable"));

        String result = tool.stageOrder("BUY", "AAPL", "10", null, null);

        assertThat(result).startsWith("Error staging order:");
        assertThat(result).contains("Redis unavailable");
    }

    @Test
    void stageOrder_parsesNullStringAsNull() {
        when(tradingService.stage(eq(TEST_USER_ID), any(UnifiedTradeOperation.class)))
                .thenReturn("Staged: BUY 5 of AAPL (Stock) (1 operation staged)");

        tool.stageOrder("BUY", "AAPL", "5", "null", "null");

        ArgumentCaptor<UnifiedTradeOperation> captor = ArgumentCaptor.forClass(UnifiedTradeOperation.class);
        verify(tradingService).stage(eq(TEST_USER_ID), captor.capture());

        UnifiedTradeOperation captured = captor.getValue();
        assertThat(captured.notional()).isNull();
        assertThat(captured.price()).isNull();
    }

    @Test
    void stageOrder_parsesCryptoSpotPair() {
        when(tradingService.stage(eq(TEST_USER_ID), any(UnifiedTradeOperation.class)))
                .thenReturn("Staged: BUY 0.5 of BTC/USD Crypto @SMART (1 operation staged)");

        tool.stageOrder("BUY", "BTC/USD", "0.5", null, null);

        ArgumentCaptor<UnifiedTradeOperation> captor = ArgumentCaptor.forClass(UnifiedTradeOperation.class);
        verify(tradingService).stage(eq(TEST_USER_ID), captor.capture());

        UnifiedTradeOperation captured = captor.getValue();
        assertThat(captured.contract().secType()).isEqualTo(SecurityType.CRYPTO);
        assertThat(captured.contract().symbol()).isEqualTo("BTC");
        assertThat(captured.contract().currency()).isEqualTo("USD");
    }
}
