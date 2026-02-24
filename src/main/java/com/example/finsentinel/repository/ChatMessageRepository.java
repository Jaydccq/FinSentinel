package com.example.finsentinel.repository;

import com.example.finsentinel.model.ChatMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Declares persistence operations for chat message repository data.
 *
 * <p>This interface is part of the repository layer in FinSentinel.
 */

public interface ChatMessageRepository extends JpaRepository<ChatMessage, UUID> {


    List<ChatMessage> findBySessionIdOrderByCreatedAtAsc(UUID sessionId);

    List<ChatMessage> findTop100BySessionIdOrderByCreatedAtAsc(UUID sessionId);

    List<ChatMessage> findBySessionIdAndUserIdOrderByCreatedAtAsc(UUID sessionId, UUID userId);

    List<ChatMessage> findTop100BySessionIdAndUserIdOrderByCreatedAtAsc(UUID sessionId, UUID userId);

    List<ChatMessage> findByUserIdOrderByCreatedAtDesc(UUID userId);

    List<ChatMessage> findTop50ByUserIdOrderByCreatedAtDesc(UUID userId);

    /**
     * Aggregates session summaries at the database level.
     * Returns one row per session with first user message, message count, and time bounds.
     */
    @Query(value = """
            SELECT
                cm.session_id AS sessionId,
                (SELECT content FROM chat_messages sub
                 WHERE sub.session_id = cm.session_id AND sub.user_id = :userId AND sub.role = 'user'
                 ORDER BY sub.created_at ASC LIMIT 1) AS firstMessage,
                CAST(COUNT(*) AS int) AS messageCount,
                MIN(cm.created_at) AS createdAt,
                MAX(cm.created_at) AS lastMessageAt
            FROM chat_messages cm
            WHERE cm.user_id = :userId
            GROUP BY cm.session_id
            ORDER BY MAX(cm.created_at) DESC
            """, nativeQuery = true)
    List<SessionSummaryProjection> findSessionSummaries(@Param("userId") UUID userId);

    interface SessionSummaryProjection {
        UUID getSessionId();
        String getFirstMessage();
        int getMessageCount();
        LocalDateTime getCreatedAt();
        LocalDateTime getLastMessageAt();
    }
}
