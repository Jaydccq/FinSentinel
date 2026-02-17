package com.example.finsentinel.dto.risk;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;

@JsonPropertyOrder({"disclaimer", "regulatoryFramework", "isCompliant"})
public record ComplianceNote(
        String disclaimer,
        String regulatoryFramework,
        boolean isCompliant
) {
}
