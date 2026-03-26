package com.example.finsentinel.service.trading.uta;

import com.example.finsentinel.model.TradeWallet;
import com.example.finsentinel.model.User;
import com.example.finsentinel.repository.TradeWalletRepository;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.event.AgentEventService;
import com.example.finsentinel.util.HashUtils;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class UnifiedTradingServiceTest {

    @Mock BrokerRegistry brokerRegistry;
    @Mock TradeWalletRepository walletRepository;
    @Mock UserRepository userRepository;
    @Mock com.example.finsentinel.service.MarketDataService marketDataService;
    @Mock StringRedisTemplate redisTemplate;
    @Mock ValueOperations<String, String> valueOps;
    @Mock AgentEventService agentEventService;

    private UnifiedTradingService service;

    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID WALLET_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        lenient().when(redisTemplate.opsForValue()).thenReturn(valueOps);

        // Default: wallet exists
        User user = User.builder().id(USER_ID).username("testuser").email("test@test.com").build();
        TradeWallet wallet = TradeWallet.builder()
                .id(WALLET_ID)
                .user(user)
                .build();
        lenient().when(walletRepository.findByUserId(USER_ID)).thenReturn(Optional.of(wallet));

        service = new UnifiedTradingService(
                brokerRegistry, walletRepository, userRepository, marketDataService,
                redisTemplate, agentEventService);
    }

    // ───────────────────────── Stage tests ──────────────────────────────────

    @Test
    void stage_acceptsStockContract() {
        when(redisTemplate.execute(
                any(org.springframework.data.redis.core.script.DefaultRedisScript.class),
                any(java.util.List.class), anyString(), anyString(), anyString())).thenReturn(1L);

        Contract stockContract = Contract.stock("AAPL");
        UnifiedTradeOperation op = new UnifiedTradeOperation(
                "BUY", stockContract, new BigDecimal("10"), null, null);

        String result = service.stage(USER_ID, op);

        assertThat(result).contains("Staged:");
        assertThat(result).contains("AAPL");
        assertThat(result).contains("1 operation staged");
    }

    @Test
    void stage_acceptsCryptoContract() {
        when(redisTemplate.execute(
                any(org.springframework.data.redis.core.script.DefaultRedisScript.class),
                any(java.util.List.class), anyString(), anyString(), anyString())).thenReturn(1L);

        Contract perpContract = Contract.cryptoPerp("BTC", "USDT", "OKX");
        UnifiedTradeOperation op = new UnifiedTradeOperation(
                "BUY", perpContract, new BigDecimal("0.5"), null, null);

        String result = service.stage(USER_ID, op);

        assertThat(result).contains("Staged:");
        assertThat(result).contains("BTC");
        assertThat(result).contains("1 operation staged");
    }

    @Test
    void stage_rejectsInvalidAction() {
        Contract contract = Contract.stock("AAPL");
        UnifiedTradeOperation op = new UnifiedTradeOperation(
                "INVALID", contract, new BigDecimal("10"), null, null);

        assertThatThrownBy(() -> service.stage(USER_ID, op))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid action")
                .hasMessageContaining("INVALID");
    }

    @Test
    void stage_rejectsNullContract() {
        UnifiedTradeOperation op = new UnifiedTradeOperation(
                "BUY", null, new BigDecimal("10"), null, null);

        assertThatThrownBy(() -> service.stage(USER_ID, op))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Contract must not be null");
    }

    // ───────────────────────── Commit tests ─────────────────────────────────

    @Test
    void commit_generatesHashAndStoresInRedis() {
        // Simulate staged operations in Redis
        String stagedJson = """
                [{"action":"BUY","contract":{"symbol":"AAPL","secType":"STOCK","exchange":"SMART","currency":"USD","expiry":null,"strike":null,"right":null,"multiplier":null},"qty":10,"notional":null,"price":null}]""";
        when(valueOps.get("uta:staging:" + USER_ID)).thenReturn(stagedJson);

        String result = service.commit(USER_ID, "Going long on AAPL — strong earnings");

        assertThat(result).contains("Committed:");
        assertThat(result).contains("Going long on AAPL");
        assertThat(result).contains("1 operation");
        assertThat(result).contains("Call executeTrade to finalize");

        // Verify pending commit was saved to Redis
        ArgumentCaptor<String> jsonCaptor = ArgumentCaptor.forClass(String.class);
        verify(valueOps).set(eq("uta:pending:" + USER_ID), jsonCaptor.capture(), eq(Duration.ofMinutes(30)));

        String pendingJson = jsonCaptor.getValue();
        assertThat(pendingJson).contains("\"hash\"");
        assertThat(pendingJson).contains("Going long on AAPL");

        // Verify staging was cleared after commit
        verify(redisTemplate).delete("uta:staging:" + USER_ID);
    }
}
