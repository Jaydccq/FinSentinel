package com.example.finsentinel.service.autonomy;

import com.example.finsentinel.config.AutonomyProperties;
import com.example.finsentinel.model.AgentHeartbeatConfig;
import com.example.finsentinel.model.TradeWallet;
import com.example.finsentinel.model.enums.AgentEventType;
import com.example.finsentinel.repository.AgentHeartbeatConfigRepository;
import com.example.finsentinel.repository.TradeWalletRepository;
import com.example.finsentinel.service.event.AgentEventService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AgentHeartbeatServiceTest {

    @Mock private AgentHeartbeatConfigRepository heartbeatConfigRepository;
    @Mock private TradeWalletRepository tradeWalletRepository;
    @Mock private AgentEventService agentEventService;

    private AgentHeartbeatService service;

    @BeforeEach
    void setUp() {
        AutonomyProperties props = new AutonomyProperties();
        service = new AgentHeartbeatService(
                heartbeatConfigRepository,
                tradeWalletRepository,
                agentEventService,
                props
        );
    }

    @Test
    void runHeartbeatOnce_highDrawdown_shouldEmitTickAndAlert() {
        UUID userId = UUID.randomUUID();
        AgentHeartbeatConfig cfg = AgentHeartbeatConfig.builder()
                .userId(userId)
                .enabled(true)
                .intervalSeconds(300)
                .drawdownAlertPct(new BigDecimal("10.00"))
                .build();
        when(heartbeatConfigRepository.findById(userId)).thenReturn(Optional.of(cfg));
        when(heartbeatConfigRepository.save(any(AgentHeartbeatConfig.class))).thenAnswer(inv -> inv.getArgument(0));

        TradeWallet wallet = TradeWallet.builder()
                .cashBalance(new BigDecimal("80000.00"))
                .initialCapital(new BigDecimal("100000.00"))
                .positions(new ArrayList<>())
                .build();
        when(tradeWalletRepository.findByUserId(userId)).thenReturn(Optional.of(wallet));

        var payload = service.runHeartbeatOnce(userId, "test");

        assertThat(payload.get("alert")).isEqualTo(true);
        assertThat(payload.get("drawdownPct")).isEqualTo(new BigDecimal("20.00"));

        ArgumentCaptor<AgentEventType> eventTypeCaptor = ArgumentCaptor.forClass(AgentEventType.class);
        verify(agentEventService, atLeast(2)).append(
                eq(userId), any(), any(), eventTypeCaptor.capture(), any(), any());
        assertThat(eventTypeCaptor.getAllValues()).contains(AgentEventType.HEARTBEAT_TICK);
        assertThat(eventTypeCaptor.getAllValues()).contains(AgentEventType.HEARTBEAT_ALERT);
    }
}
