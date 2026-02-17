package com.example.finsentinel.dto.chat;

import java.time.LocalDateTime;
import java.util.UUID;

public record ChatMessageResponse(
        UUID id,
        UUID sessionId,
        String role,
        String content,
        LocalDateTime createdAt
) {
}
