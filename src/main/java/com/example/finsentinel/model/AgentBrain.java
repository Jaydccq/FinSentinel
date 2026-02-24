package com.example.finsentinel.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Persistent cognitive state entity implementing the OpenAlice Brain pattern.
 *
 * <p>Each user has one brain that stores the AI trading agent's learned strategy
 * (frontal lobe), current emotional state, and a git-like commit history of all
 * cognitive state changes. This allows the agent to learn from its own trade
 * history across conversations.
 *
 * <p>The commit history provides an immutable audit trail of every strategy
 * update and emotional state change, with SHA-256 hashed entries for integrity.
 *
 * <p>This class belongs to the model layer in FinSentinel.
 */
@Entity
@Table(name = "agent_brains")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AgentBrain {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    private User user;

    /**
     * The agent's learned trading strategy and reasoning patterns (frontal lobe).
     * <p>Updated as the agent reflects on past trades and market conditions.
     */
    @Column(columnDefinition = "text")
    @Builder.Default
    private String frontalLobe = "";

    /**
     * Current emotional state of the agent (e.g. neutral, confident, cautious, fearful, greedy).
     */
    @Column(length = 20, nullable = false)
    @Builder.Default
    private String emotion = "neutral";

    /**
     * Commit history as JSONB (OpenAlice commit log pattern).
     * <p>Each entry: {"hash":"abc12345","type":"strategy|emotion","message":"...",
     * "timestamp":"..."}
     * <p>Capped at 50 entries to bound storage.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    @Builder.Default
    private List<Map<String, Object>> commitHistory = new ArrayList<>();

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
