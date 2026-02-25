package com.example.finsentinel.dto.autonomy;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import java.math.BigDecimal;

/**
 * Request payload for updating heartbeat configuration.
 */
public record HeartbeatConfigRequest(
        Boolean enabled,
        @Min(60) @Max(3600) Integer intervalSeconds,
        @DecimalMin("0.10") @DecimalMax("95.00") BigDecimal drawdownAlertPct
) {
}
