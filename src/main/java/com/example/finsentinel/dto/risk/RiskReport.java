package com.example.finsentinel.dto.risk;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import java.util.List;

@JsonPropertyOrder({"riskScore", "riskLevel", "summary", "factors", "actionableAdvice", "complianceNote"})
public record RiskReport(
        int riskScore,
        String riskLevel,
        String summary,
        List<RiskFactor> factors,
        List<String> actionableAdvice,
        ComplianceNote complianceNote
) {
}
