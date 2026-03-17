package com.example.finsentinel.dto.apikey;

import jakarta.validation.constraints.NotBlank;

/**
 * Request DTO for saving an API key value.
 *
 * @param value the plaintext API key value to encrypt and store
 */
public record ApiKeySaveRequest(
        @NotBlank(message = "API key value must not be blank")
        String value
) {}
