package com.example.finsentinel.service.event;

import com.example.finsentinel.model.AgentEvent;
import com.example.finsentinel.model.enums.AgentEventAggregateType;
import com.example.finsentinel.model.enums.AgentEventType;
import com.example.finsentinel.repository.AgentEventRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AgentEventServiceTest {

    @Mock
    private AgentEventRepository agentEventRepository;

    private AgentEventService service;

    @BeforeEach
    void setUp() {
        service = new AgentEventService(agentEventRepository);
    }

    @Test
    void append_withIdempotencyKey_shouldReturnExisting() {
        UUID userId = UUID.randomUUID();
        AgentEvent existing = AgentEvent.builder()
                .id(UUID.randomUUID())
                .userId(userId)
                .aggregateType(AgentEventAggregateType.CHAT_SESSION)
                .eventType(AgentEventType.CHAT_MESSAGE_PERSISTED)
                .payloadJson(Map.of("k", "v"))
                .idempotencyKey("k1")
                .build();
        when(agentEventRepository.findByUserIdAndIdempotencyKey(userId, "k1")).thenReturn(Optional.of(existing));

        AgentEvent result = service.append(
                userId,
                AgentEventAggregateType.CHAT_SESSION,
                UUID.randomUUID(),
                AgentEventType.CHAT_MESSAGE_PERSISTED,
                Map.of("x", 1),
                "k1"
        );

        assertThat(result).isSameAs(existing);
        verify(agentEventRepository, never()).save(any());
    }

    @Test
    void append_withoutExisting_shouldPersistCopyOfPayload() {
        UUID userId = UUID.randomUUID();
        when(agentEventRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(agentEventRepository.findByUserIdAndIdempotencyKey(userId, "k2")).thenReturn(Optional.empty());

        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("a", 1);

        AgentEvent result = service.append(
                userId,
                AgentEventAggregateType.TRADE_WALLET,
                UUID.randomUUID(),
                AgentEventType.TRADE_COMMIT_CREATED,
                payload,
                "k2"
        );

        payload.put("b", 2);
        assertThat(result.getPayloadJson()).containsEntry("a", 1);
        assertThat(result.getPayloadJson()).doesNotContainKey("b");
    }

    @Test
    void replayAfter_invalidCursor_shouldThrow() {
        assertThatThrownBy(() -> service.replayAfter(UUID.randomUUID(), -1L, 10))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("afterSeqNo");
    }

    @Test
    void getRecent_shouldClampLimitToMax200() {
        UUID userId = UUID.randomUUID();
        when(agentEventRepository.findByUserIdOrderBySeqNoDesc(eq(userId), any(Pageable.class))).thenReturn(List.of());

        service.getRecent(userId, 999);

        ArgumentCaptor<Pageable> pageableCaptor = ArgumentCaptor.forClass(Pageable.class);
        verify(agentEventRepository).findByUserIdOrderBySeqNoDesc(eq(userId), pageableCaptor.capture());
        assertThat(pageableCaptor.getValue().getPageSize()).isEqualTo(200);
    }
}
