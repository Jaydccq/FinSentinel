package com.example.finsentinel.dto.risk;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;

import java.util.List;

/**
 * Structured risk assessment output returned by the AI workflow.
 *
 * @param riskScore overall risk score in range 0-100
 * @param riskLevel textual risk level
 * @param summary short executive summary
 * @param factors list of detailed risk factors
 * @param actionableAdvice mitigation recommendations
 */
@JsonPropertyOrder({"riskScore", "riskLevel", "summary", "factors", "actionableAdvice"})
public record RiskReport(
        int riskScore,
        String riskLevel,
        String summary,
        List<RiskFactor> factors,
        List<String> actionableAdvice
) {
}
