package com.example.finsentinel.dto.trading;

import jakarta.validation.constraints.NotBlank;

/**
 * Request body for committing staged trade operations with a rationale message.
 *
 * @param message the commit message explaining the trading rationale
 */
public record CommitRequest(
        @NotBlank(message = "Commit message is required")
        String message
) {}
