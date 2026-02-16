package com.example.finsentinel.dto.risk;

import java.util.List;

public record RiskReport(
        int riskScore,
        String riskLevel,
        String summary,
        List<RiskFactor> factors,
        List<String> actionableAdvice,
        ComplianceNote complianceNote
) {
}
