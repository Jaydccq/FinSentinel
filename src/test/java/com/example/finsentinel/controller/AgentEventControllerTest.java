package com.example.finsentinel.controller;

import com.example.finsentinel.model.AgentEvent;
import com.example.finsentinel.model.User;
import com.example.finsentinel.model.enums.AgentEventAggregateType;
import com.example.finsentinel.model.enums.AgentEventType;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.event.AgentEventService;
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
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AgentEventControllerTest {

    @Mock
    private AgentEventService agentEventService;
    @Mock
    private UserRepository userRepository;
    @Mock
    private org.springframework.security.core.userdetails.UserDetails userDetails;

    private AgentEventController controller;

    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        controller = new AgentEventController(agentEventService, userRepository);
        when(userDetails.getUsername()).thenReturn("demo");
        User user = new User();
        user.setId(userId);
        when(userRepository.findByUsername("demo")).thenReturn(Optional.of(user));
    }

    @Test
    void listEvents_withoutAfterSeq_shouldReturnRecent() {
        AgentEvent event = AgentEvent.builder()
                .id(UUID.randomUUID())
                .seqNo(10L)
                .userId(userId)
                .aggregateType(AgentEventAggregateType.CHAT_SESSION)
                .aggregateId(UUID.randomUUID())
                .eventType(AgentEventType.CHAT_MESSAGE_PERSISTED)
                .payloadJson(Map.of("role", "user"))
                .build();
        when(agentEventService.getRecent(eq(userId), eq(20))).thenReturn(List.of(event));

        var response = controller.listEvents(null, 20, userDetails);

        assertThat(response.getBody()).hasSize(1);
        assertThat(response.getBody().getFirst().seqNo()).isEqualTo(10L);
        assertThat(response.getBody().getFirst().eventType()).isEqualTo("CHAT_MESSAGE_PERSISTED");
        verify(agentEventService).getRecent(userId, 20);
    }

    @Test
    void listEvents_withAfterSeq_shouldReplayAscending() {
        AgentEvent event = AgentEvent.builder()
                .id(UUID.randomUUID())
                .seqNo(11L)
                .userId(userId)
                .aggregateType(AgentEventAggregateType.TRADE_WALLET)
                .eventType(AgentEventType.TRADE_COMMIT_EXECUTED)
                .payloadJson(Map.of("hash", "abc"))
                .build();
        when(agentEventService.replayAfter(eq(userId), eq(10L), eq(50))).thenReturn(List.of(event));

        var response = controller.listEvents(10L, 50, userDetails);

        assertThat(response.getBody()).hasSize(1);
        assertThat(response.getBody().getFirst().seqNo()).isEqualTo(11L);
        assertThat(response.getBody().getFirst().eventType()).isEqualTo("TRADE_COMMIT_EXECUTED");
        verify(agentEventService).replayAfter(userId, 10L, 50);
    }
}
