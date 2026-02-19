package com.example.finsentinel.dto.risk;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;

/**
 * One factor that contributes to a risk score.
 *
 * @param category risk category name
 * @param score category-specific score
 * @param description factor explanation
 */
@JsonPropertyOrder({"category", "score", "description"})
public record RiskFactor(
        String category,
        int score,
        String description
) {
}
