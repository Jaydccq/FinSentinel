package com.example.finsentinel.model;

import com.example.finsentinel.model.enums.AgentEventAggregateType;
import com.example.finsentinel.model.enums.AgentEventType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Typed append-only event record for agent autonomy workflows.
 */
@Entity
@Table(name = "agent_events")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AgentEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "seq_no", insertable = false, updatable = false, nullable = false)
    private Long seqNo;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "aggregate_type", length = 50, nullable = false, updatable = false)
    private AgentEventAggregateType aggregateType;

    @Column(name = "aggregate_id", updatable = false)
    private UUID aggregateId;

    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", length = 100, nullable = false, updatable = false)
    private AgentEventType eventType;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payload_json", columnDefinition = "jsonb", nullable = false, updatable = false)
    @Builder.Default
    private Map<String, Object> payloadJson = new LinkedHashMap<>();

    @Column(name = "idempotency_key", length = 128, updatable = false)
    private String idempotencyKey;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false, nullable = false)
    private LocalDateTime createdAt;

    @PreUpdate
    void preventUpdate() {
        throw new UnsupportedOperationException("AgentEvent is append-only and cannot be updated");
    }
}
