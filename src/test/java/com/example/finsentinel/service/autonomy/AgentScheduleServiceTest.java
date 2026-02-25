package com.example.finsentinel.service.autonomy;

import com.example.finsentinel.config.AutonomyProperties;
import com.example.finsentinel.model.AgentSchedule;
import com.example.finsentinel.model.enums.AgentScheduleTaskType;
import com.example.finsentinel.repository.AgentScheduleRepository;
import com.example.finsentinel.service.event.AgentEventService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AgentScheduleServiceTest {

    @Mock private AgentScheduleRepository scheduleRepository;
    @Mock private AgentScheduleRegistry scheduleRegistry;
    @Mock private AgentEventService agentEventService;

    private AutonomyProperties autonomyProperties;
    private AgentScheduleService service;

    @BeforeEach
    void setUp() {
        autonomyProperties = new AutonomyProperties();
        service = new AgentScheduleService(scheduleRepository, scheduleRegistry, agentEventService, autonomyProperties);
    }

    @Test
    void create_invalidCron_shouldThrow() {
        assertThatThrownBy(() -> service.create(
                UUID.randomUUID(),
                "Every minute",
                "invalid-cron",
                "PORTFOLIO_REVIEW",
                Map.of(),
                true
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid cron expression");
    }

    @Test
    void create_shouldThrow_whenMaxSchedulesReached() {
        UUID userId = UUID.randomUUID();
        when(scheduleRepository.countByUserId(userId)).thenReturn(20L);

        assertThatThrownBy(() -> service.create(
                userId,
                "One Too Many",
                "0 */15 * * * *",
                "PORTFOLIO_REVIEW",
                Map.of(),
                true
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Maximum");
    }

    @Test
    void create_validSchedule_shouldPersistAndReschedule() {
        UUID userId = UUID.randomUUID();
        when(scheduleRepository.save(any(AgentSchedule.class))).thenAnswer(inv -> {
            AgentSchedule s = inv.getArgument(0);
            s.setId(UUID.randomUUID());
            s.setTaskType(AgentScheduleTaskType.PORTFOLIO_REVIEW);
            return s;
        });

        service.create(
                userId,
                "Check Wallet",
                "0 */15 * * * *",
                "PORTFOLIO_REVIEW",
                Map.of(),
                true
        );

        verify(scheduleRepository).save(any(AgentSchedule.class));
        verify(scheduleRegistry).reschedule(any(AgentSchedule.class));
    }
}
