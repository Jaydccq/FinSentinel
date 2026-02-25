package com.example.finsentinel.dto.event;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

/**
 * Event log response item.
 */
public record AgentEventResponse(
        UUID id,
        Long seqNo,
        UUID userId,
        String aggregateType,
        UUID aggregateId,
        String eventType,
        Map<String, Object> payload,
        LocalDateTime createdAt
) {
}
