package com.example.finsentinel.dto.autonomy;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

/**
 * API response payload for autonomous schedule entries.
 */
public record AgentScheduleResponse(
        UUID id,
        String name,
        String cronExpression,
        String taskType,
        Map<String, Object> payload,
        boolean enabled,
        LocalDateTime lastRunAt,
        LocalDateTime nextRunAt,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
}
