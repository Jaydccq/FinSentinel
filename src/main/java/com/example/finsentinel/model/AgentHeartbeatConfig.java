package com.example.finsentinel.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Per-user heartbeat configuration for autonomous wake-up checks.
 */
@Entity
@Table(name = "agent_heartbeat_configs")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AgentHeartbeatConfig {

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    @Builder.Default
    private boolean enabled = true;

    @Column(name = "interval_seconds", nullable = false)
    @Builder.Default
    private int intervalSeconds = 600;

    @Column(name = "drawdown_alert_pct", precision = 5, scale = 2, nullable = false)
    @Builder.Default
    private BigDecimal drawdownAlertPct = new BigDecimal("10.00");

    @Column(name = "last_beat_at")
    private LocalDateTime lastBeatAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false, nullable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
