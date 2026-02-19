package com.example.finsentinel.dto.chat;

import jakarta.validation.constraints.NotBlank;

import java.util.UUID;

/**
 * Chat request payload used by risk assessment and streaming endpoints.
 *
 * @param message user prompt content
 * @param sessionId optional session identifier for conversation continuity
 */
public record ChatRequest(
        @NotBlank String message,
        UUID sessionId
) {
}
