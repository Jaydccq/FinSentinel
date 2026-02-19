package com.example.finsentinel.dto.auth;

import jakarta.validation.constraints.NotBlank;

/**
 * Login request payload.
 *
 * @param username account username
 * @param password plain-text password supplied by the client
 */
public record LoginRequest(
        @NotBlank String username,
        @NotBlank String password
) {
}
