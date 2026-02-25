package com.example.finsentinel.service.event;

import com.example.finsentinel.model.AgentEvent;
import com.example.finsentinel.model.enums.AgentEventAggregateType;
import com.example.finsentinel.model.enums.AgentEventType;
import com.example.finsentinel.repository.AgentEventRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Append-only event log service for agent autonomy workflows.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentEventService {

    private static final int MAX_QUERY_LIMIT = 200;
    private static final int DEFAULT_QUERY_LIMIT = 50;

    private final AgentEventRepository agentEventRepository;

    /**
     * Appends one immutable event.
     *
     * <p>If an idempotency key is provided and already exists, returns the existing event.
     */
    @Transactional
    public AgentEvent append(UUID userId,
                             AgentEventAggregateType aggregateType,
                             UUID aggregateId,
                             AgentEventType eventType,
                             Map<String, Object> payload,
                             String idempotencyKey) {
        if (userId == null || aggregateType == null || eventType == null) {
            throw new IllegalArgumentException("userId, aggregateType and eventType are required");
        }

        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            var existing = agentEventRepository.findByUserIdAndIdempotencyKey(userId, idempotencyKey);
            if (existing.isPresent()) {
                return existing.get();
            }
        }

        Map<String, Object> safePayload = payload == null
                ? new LinkedHashMap<>()
                : new LinkedHashMap<>(payload);

        AgentEvent event = AgentEvent.builder()
                .userId(userId)
                .aggregateType(aggregateType)
                .aggregateId(aggregateId)
                .eventType(eventType)
                .payloadJson(safePayload)
                .idempotencyKey((idempotencyKey == null || idempotencyKey.isBlank()) ? null : idempotencyKey)
                .build();

        AgentEvent saved = agentEventRepository.save(event);
        log.debug("Appended event seq={} user={} aggregate={} type={}",
                saved.getSeqNo(), saved.getUserId(), saved.getAggregateType(), saved.getEventType());
        return saved;
    }

    @Transactional(readOnly = true)
    public List<AgentEvent> getRecent(UUID userId, Integer limit) {
        int clamped = clampLimit(limit);
        return agentEventRepository.findByUserIdOrderBySeqNoDesc(
                userId, PageRequest.of(0, clamped));
    }

    @Transactional(readOnly = true)
    public List<AgentEvent> replayAfter(UUID userId, Long afterSeqNo, Integer limit) {
        if (afterSeqNo == null || afterSeqNo < 0) {
            throw new IllegalArgumentException("afterSeqNo must be >= 0");
        }
        int clamped = clampLimit(limit);
        return agentEventRepository.findByUserIdAndSeqNoGreaterThanOrderBySeqNoAsc(
                userId, afterSeqNo, PageRequest.of(0, clamped));
    }

    private int clampLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_QUERY_LIMIT;
        }
        return Math.min(Math.max(limit, 1), MAX_QUERY_LIMIT);
    }
}
