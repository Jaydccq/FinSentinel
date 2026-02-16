package com.example.finsentinel.dto.auth;

public record AuthResponse(
        String token,
        String username,
        String email
) {
}
