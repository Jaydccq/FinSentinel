package com.example.finsentinel.dto.portfolio;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.math.BigDecimal;

/**
 * Request payload for creating or updating a holding within a portfolio.
 *
 * @param symbol asset ticker symbol
 * @param companyName optional company name
 * @param quantity holding quantity
 * @param averageCost average acquisition cost per unit
 * @param sector optional sector label
 */
public record HoldingRequest(
        @NotBlank String symbol,
        String companyName,
        @NotNull @Positive BigDecimal quantity,
        @NotNull @Positive BigDecimal averageCost,
        String sector
) {
}
