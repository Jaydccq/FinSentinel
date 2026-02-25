package com.example.finsentinel.controller;

import com.example.finsentinel.dto.autonomy.HeartbeatConfigRequest;
import com.example.finsentinel.model.AgentHeartbeatConfig;
import com.example.finsentinel.model.User;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.autonomy.AgentHeartbeatService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class HeartbeatControllerTest {

    @Mock private AgentHeartbeatService heartbeatService;
    @Mock private UserRepository userRepository;
    @Mock private org.springframework.security.core.userdetails.UserDetails userDetails;

    private HeartbeatController controller;
    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        controller = new HeartbeatController(heartbeatService, userRepository);
        when(userDetails.getUsername()).thenReturn("demo");
        User user = new User();
        user.setId(userId);
        when(userRepository.findByUsername("demo")).thenReturn(Optional.of(user));
    }

    @Test
    void get_shouldReturnConfig() {
        AgentHeartbeatConfig cfg = AgentHeartbeatConfig.builder()
                .userId(userId)
                .enabled(true)
                .intervalSeconds(600)
                .drawdownAlertPct(new BigDecimal("12.00"))
                .build();
        when(heartbeatService.getOrCreateConfig(userId)).thenReturn(cfg);

        var response = controller.get(userDetails);

        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().enabled()).isTrue();
        assertThat(response.getBody().intervalSeconds()).isEqualTo(600);
    }

    @Test
    void update_shouldDelegateToService() {
        HeartbeatConfigRequest request = new HeartbeatConfigRequest(true, 300, new BigDecimal("8.50"));
        AgentHeartbeatConfig cfg = AgentHeartbeatConfig.builder()
                .userId(userId)
                .enabled(true)
                .intervalSeconds(300)
                .drawdownAlertPct(new BigDecimal("8.50"))
                .build();
        when(heartbeatService.updateConfig(eq(userId), any(), any(), any())).thenReturn(cfg);

        var response = controller.update(request, userDetails);

        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().drawdownAlertPct()).isEqualTo(new BigDecimal("8.50"));
    }
}
