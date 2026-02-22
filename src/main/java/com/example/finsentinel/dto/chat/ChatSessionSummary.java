package com.example.finsentinel.dto.chat;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Summary of a chat session for the session list sidebar.
 *
 * @param sessionId    unique session identifier
 * @param firstMessage truncated first user message (used as title)
 * @param messageCount total messages in the session
 * @param createdAt    timestamp of the first message
 * @param lastMessageAt timestamp of the most recent message
 */
public record ChatSessionSummary(
        UUID sessionId,
        String firstMessage,
        int messageCount,
        LocalDateTime createdAt,
        LocalDateTime lastMessageAt
) {
}
