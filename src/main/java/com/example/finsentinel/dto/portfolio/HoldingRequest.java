package com.example.finsentinel.dto.portfolio;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.math.BigDecimal;

public record HoldingRequest(
        @NotBlank String symbol,
        String companyName,
        @NotNull @Positive BigDecimal quantity,
        @NotNull @Positive BigDecimal averageCost,
        String sector
) {
}
