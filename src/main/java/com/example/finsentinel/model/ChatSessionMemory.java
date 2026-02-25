package com.example.finsentinel.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Compacted long-context memory per chat session.
 */
@Entity
@Table(name = "chat_session_memories",
        uniqueConstraints = @UniqueConstraint(name = "uk_chat_session_memory_user_session",
                columnNames = {"user_id", "session_id"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ChatSessionMemory {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    @Column(name = "summary_text", columnDefinition = "TEXT", nullable = false)
    @Builder.Default
    private String summaryText = "";

    @Column(name = "compacted_message_count", nullable = false)
    @Builder.Default
    private int compactedMessageCount = 0;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false, nullable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
