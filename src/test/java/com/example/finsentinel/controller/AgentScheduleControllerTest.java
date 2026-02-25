package com.example.finsentinel.controller;

import com.example.finsentinel.dto.autonomy.AgentScheduleRequest;
import com.example.finsentinel.model.AgentSchedule;
import com.example.finsentinel.model.User;
import com.example.finsentinel.model.enums.AgentScheduleTaskType;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.autonomy.AgentScheduleService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AgentScheduleControllerTest {

    @Mock private AgentScheduleService scheduleService;
    @Mock private UserRepository userRepository;
    @Mock private org.springframework.security.core.userdetails.UserDetails userDetails;

    private AgentScheduleController controller;
    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        controller = new AgentScheduleController(scheduleService, userRepository);
        when(userDetails.getUsername()).thenReturn("demo");
        User user = new User();
        user.setId(userId);
        when(userRepository.findByUsername("demo")).thenReturn(Optional.of(user));
    }

    @Test
    void list_shouldReturnSchedules() {
        AgentSchedule schedule = AgentSchedule.builder()
                .id(UUID.randomUUID())
                .userId(userId)
                .name("Every hour")
                .cronExpression("0 0 * * * *")
                .taskType(AgentScheduleTaskType.PORTFOLIO_REVIEW)
                .taskPayload(Map.of())
                .enabled(true)
                .build();
        when(scheduleService.listByUser(userId)).thenReturn(List.of(schedule));

        var response = controller.list(userDetails);

        assertThat(response.getBody()).hasSize(1);
        assertThat(response.getBody().getFirst().taskType()).isEqualTo("PORTFOLIO_REVIEW");
    }

    @Test
    void create_shouldDelegateToService() {
        AgentScheduleRequest request = new AgentScheduleRequest(
                "Pulse",
                "0 */30 * * * *",
                "MARKET_PULSE",
                Map.of("tickers", List.of("AAPL")),
                true
        );
        AgentSchedule saved = AgentSchedule.builder()
                .id(UUID.randomUUID())
                .userId(userId)
                .name("Pulse")
                .cronExpression("0 */30 * * * *")
                .taskType(AgentScheduleTaskType.MARKET_PULSE)
                .taskPayload(Map.of("tickers", List.of("AAPL")))
                .enabled(true)
                .build();
        when(scheduleService.create(eq(userId), any(), any(), any(), any(), any())).thenReturn(saved);

        var response = controller.create(request, userDetails);

        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().taskType()).isEqualTo("MARKET_PULSE");
    }
}
