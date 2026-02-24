package com.example.finsentinel.dto.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Registration request payload.
 *
 * @param username unique username for account creation
 * @param email email address used for authentication and communication
 * @param password raw password that will be hashed before persistence
 * @param displayName optional display name shown in the UI
 */
public record RegisterRequest(
        @NotBlank @Size(min = 3, max = 50) String username,
        @NotBlank @Email String email,
        @NotBlank @Size(min = 8, max = 100)
        @Pattern(regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).+$",
                 message = "Password must contain at least one uppercase letter, one lowercase letter, and one digit")
        String password,
        String displayName
) {
}
