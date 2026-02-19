package com.example.finsentinel.dto.auth;

/**
 * Authentication response payload returned after login or registration.
 *
 * @param token JWT access token issued for the authenticated user
 * @param username authenticated username
 * @param email authenticated user email
 */
public record AuthResponse(String token, String username, String email) {
}
