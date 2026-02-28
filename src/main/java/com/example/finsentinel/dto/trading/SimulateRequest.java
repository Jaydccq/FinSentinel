package com.example.finsentinel.dto.trading;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Request body for simulating a hypothetical price change on a position.
 *
 * @param ticker        the ticker to simulate a price change for
 * @param changePercent the percentage change to simulate (e.g., -10.0 for a 10% drop)
 */
public record SimulateRequest(
        @NotBlank(message = "Ticker is required")
        String ticker,

        @NotNull(message = "Change percent is required")
        Double changePercent
) {}
