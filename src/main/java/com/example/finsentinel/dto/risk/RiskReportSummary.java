package com.example.finsentinel.dto.risk;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Summary projection for listing historical risk reports by portfolio.
 *
 * @param id report identifier
 * @param riskScore overall risk score
 * @param riskLevel textual risk level
 * @param summary summary text
 * @param factors risk factors
 * @param actionableAdvice recommended actions
 * @param complianceNote compliance metadata
 * @param createdAt report creation timestamp
 */
public record RiskReportSummary(
        UUID id,
        int riskScore,
        String riskLevel,
        String summary,
        List<RiskFactor> factors,
        List<String> actionableAdvice,
        ComplianceNote complianceNote,
        LocalDateTime createdAt
) {
}
