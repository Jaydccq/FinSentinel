package com.example.finsentinel.dto.risk;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;

@JsonPropertyOrder({"category", "score", "description"})
public record RiskFactor(
        String category,
        int score,
        String description
) {
}
