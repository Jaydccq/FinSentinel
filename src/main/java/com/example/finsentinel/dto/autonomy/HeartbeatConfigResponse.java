package com.example.finsentinel.dto.autonomy;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * API response for user heartbeat settings.
 */
public record HeartbeatConfigResponse(
        boolean enabled,
        int intervalSeconds,
        BigDecimal drawdownAlertPct,
        LocalDateTime lastBeatAt,
        LocalDateTime updatedAt
) {
}
