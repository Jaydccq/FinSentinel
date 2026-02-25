package com.example.finsentinel.dto.autonomy;

import jakarta.validation.constraints.NotBlank;

import java.util.Map;

/**
 * Request payload for creating/updating autonomous schedules.
 */
public record AgentScheduleRequest(
        @NotBlank String name,
        @NotBlank String cronExpression,
        @NotBlank String taskType,
        Map<String, Object> payload,
        Boolean enabled
) {
}
