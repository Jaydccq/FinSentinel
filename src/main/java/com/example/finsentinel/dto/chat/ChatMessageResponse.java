package com.example.finsentinel.dto.chat;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Chat message response returned to clients when querying session history.
 *
 * @param id message identifier
 * @param sessionId conversation session identifier
 * @param role message role (for example: user or assistant)
 * @param content message content
 * @param createdAt message creation timestamp
 */
public record ChatMessageResponse(
        UUID id,
        UUID sessionId,
        String role,
        String content,
        LocalDateTime createdAt
) {
}
