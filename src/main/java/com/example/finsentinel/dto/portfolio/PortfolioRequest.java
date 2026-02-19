package com.example.finsentinel.dto.portfolio;

import jakarta.validation.constraints.NotBlank;

/**
 * Request payload for creating or updating a portfolio.
 *
 * @param name portfolio name
 * @param description optional portfolio description
 */
public record PortfolioRequest(
        @NotBlank String name,
        String description
) {
}
