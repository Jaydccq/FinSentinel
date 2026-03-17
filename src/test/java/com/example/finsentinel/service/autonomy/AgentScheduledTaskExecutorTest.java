package com.example.finsentinel.service.autonomy;

import com.example.finsentinel.config.NewsProperties;
import com.example.finsentinel.model.AgentSchedule;
import com.example.finsentinel.model.enums.AgentScheduleTaskType;
import com.example.finsentinel.service.MarketDataService;
import com.example.finsentinel.service.event.AgentEventService;
import com.example.finsentinel.service.okx.OkxAnalysisService;
import com.example.finsentinel.service.trading.AgentBrainService;
import com.example.finsentinel.service.trading.PaperTradingService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import reactor.core.publisher.Flux;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class AgentScheduledTaskExecutorTest {

    private OkxAnalysisService okxAnalysisService;
    private AgentEventService agentEventService;
    private AgentScheduledTaskExecutor executor;

    @SuppressWarnings("unchecked")
    @BeforeEach
    void setUp() {
        PaperTradingService paperTradingService = mock(PaperTradingService.class);
        AgentBrainService agentBrainService = mock(AgentBrainService.class);
        MarketDataService marketDataService = mock(MarketDataService.class);
        AgentHeartbeatService heartbeatService = mock(AgentHeartbeatService.class);
        agentEventService = mock(AgentEventService.class);
        NewsProperties newsProperties = mock(NewsProperties.class);
        okxAnalysisService = mock(OkxAnalysisService.class);

        ObjectProvider<OkxAnalysisService> okxProvider = mock(ObjectProvider.class);
        when(okxProvider.getIfAvailable()).thenReturn(okxAnalysisService);

        executor = new AgentScheduledTaskExecutor(
                paperTradingService, agentBrainService, marketDataService,
                heartbeatService, agentEventService, newsProperties, okxProvider);
    }

    private AgentSchedule cryptoSchedule() {
        AgentSchedule schedule = new AgentSchedule();
        schedule.setId(UUID.randomUUID());
        schedule.setUserId(UUID.randomUUID());
        schedule.setTaskType(AgentScheduleTaskType.CRYPTO_HEALTH_CHECK);
        return schedule;
    }

    @Test
    void cryptoHealthCheck_successfulRun_setsStatusOk() {
        AgentSchedule schedule = cryptoSchedule();
        when(okxAnalysisService.streamHealthCheck(schedule.getUserId()))
                .thenReturn(Flux.just("Health ", "check ", "result."));

        Map<String, Object> result = executor.execute(schedule);

        assertThat(result.get("status")).isEqualTo("ok");
        assertThat((int) result.get("resultLength")).isGreaterThan(0);
        assertThat((String) result.get("preview")).contains("Health check result.");
    }

    @Test
    void cryptoHealthCheck_eventPersistenceFails_doesNotOverwriteSuccessStatus() {
        AgentSchedule schedule = cryptoSchedule();
        when(okxAnalysisService.streamHealthCheck(schedule.getUserId()))
                .thenReturn(Flux.just("Success"));

        // Event append throws — this should NOT flip the result to error
        doThrow(new RuntimeException("DB timeout"))
                .when(agentEventService).append(any(), any(), any(), any(), any(), any());

        Map<String, Object> result = executor.execute(schedule);

        // The health check itself succeeded — status must remain "ok"
        assertThat(result.get("status")).isEqualTo("ok");
        assertThat(result).doesNotContainKey("message");
    }

    @Test
    void cryptoHealthCheck_analysisServiceFails_setsStatusError() {
        AgentSchedule schedule = cryptoSchedule();
        when(okxAnalysisService.streamHealthCheck(schedule.getUserId()))
                .thenReturn(Flux.error(new RuntimeException("OKX unreachable")));

        Map<String, Object> result = executor.execute(schedule);

        assertThat(result.get("status")).isEqualTo("error");
        assertThat((String) result.get("message")).contains("OKX unreachable");
    }

    @Test
    void cryptoHealthCheck_okxDisabled_setsStatusSkipped() {
        // Re-create executor with null OKX provider
        @SuppressWarnings("unchecked")
        ObjectProvider<OkxAnalysisService> nullProvider = mock(ObjectProvider.class);
        when(nullProvider.getIfAvailable()).thenReturn(null);

        AgentScheduledTaskExecutor executorNoOkx = new AgentScheduledTaskExecutor(
                mock(PaperTradingService.class), mock(AgentBrainService.class),
                mock(MarketDataService.class), mock(AgentHeartbeatService.class),
                agentEventService, mock(NewsProperties.class), nullProvider);

        AgentSchedule schedule = cryptoSchedule();
        Map<String, Object> result = executorNoOkx.execute(schedule);

        assertThat(result.get("status")).isEqualTo("skipped");
    }
}
