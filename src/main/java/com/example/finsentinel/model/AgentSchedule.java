package com.example.finsentinel.model;

import com.example.finsentinel.model.enums.AgentScheduleTaskType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * User-owned autonomous cron schedule definition.
 */
@Entity
@Table(name = "agent_schedules")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AgentSchedule {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(name = "cron_expression", nullable = false, length = 120)
    private String cronExpression;

    @Enumerated(EnumType.STRING)
    @Column(name = "task_type", nullable = false, length = 50)
    private AgentScheduleTaskType taskType;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "task_payload", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> taskPayload = new LinkedHashMap<>();

    @Column(nullable = false)
    @Builder.Default
    private boolean enabled = true;

    @Column(name = "last_run_at")
    private LocalDateTime lastRunAt;

    @Column(name = "next_run_at")
    private LocalDateTime nextRunAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false, nullable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
