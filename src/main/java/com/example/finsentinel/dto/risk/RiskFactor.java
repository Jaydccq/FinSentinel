package com.example.finsentinel.dto.risk;

public record RiskFactor(
        String category,
        int score,
        String description
) {
}
