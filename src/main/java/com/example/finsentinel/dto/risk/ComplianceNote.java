package com.example.finsentinel.dto.risk;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;

/**
 * Compliance metadata attached to a generated risk report.
 *
 * @param disclaimer compliance disclaimer text
 * @param regulatoryFramework governing framework (for example: SEC)
 * @param isCompliant whether output passed compliance checks
 */
@JsonPropertyOrder({"disclaimer", "regulatoryFramework", "isCompliant"})
public record ComplianceNote(
        String disclaimer,
        String regulatoryFramework,
        boolean isCompliant
) {
}
