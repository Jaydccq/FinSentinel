package com.example.finsentinel.dto.risk;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

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
