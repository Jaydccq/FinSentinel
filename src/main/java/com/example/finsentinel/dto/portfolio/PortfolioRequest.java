package com.example.finsentinel.dto.portfolio;

import jakarta.validation.constraints.NotBlank;

public record PortfolioRequest(
        @NotBlank String name,
        String description
) {
}
