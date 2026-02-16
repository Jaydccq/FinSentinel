package com.example.finsentinel.dto.risk;

public record ComplianceNote(
        String disclaimer,
        String regulatoryFramework,
        boolean isCompliant
) {
}
