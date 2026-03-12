package com.example.finsentinel.agent.output;

import com.example.finsentinel.dto.risk.RiskReport;
import org.junit.jupiter.api.Test;
import org.springframework.ai.converter.BeanOutputConverter;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Implements AI agent logic for risk report output test workflows.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */

class RiskReportOutputTest {


    @Test
    void beanOutputConverter_shouldGenerateValidSchema() {
        BeanOutputConverter<RiskReport> converter = new BeanOutputConverter<>(RiskReport.class);
        String format = converter.getFormat();

        assertThat(format).contains("riskScore");
        assertThat(format).contains("riskLevel");
        assertThat(format).contains("factors");
        assertThat(format).contains("actionableAdvice");
    }


    @Test
    void beanOutputConverter_shouldParseValidJson() {
        BeanOutputConverter<RiskReport> converter = new BeanOutputConverter<>(RiskReport.class);

        String json = """
            {
                "riskScore": 65,
                "riskLevel": "HIGH",
                "summary": "Elevated risk due to market volatility and sector concentration.",
                "factors": [
                    {"category": "MARKET", "score": 70, "description": "Broad market uncertainty"},
                    {"category": "VOLATILITY", "score": 60, "description": "High VIX levels"}
                ],
                "actionableAdvice": [
                    "Consider diversifying into defensive sectors",
                    "Set stop-loss orders at 10% below current price"
                ]
            }
            """;

        RiskReport report = converter.convert(json);

        assertThat(report.riskScore()).isEqualTo(65);
        assertThat(report.riskLevel()).isEqualTo("HIGH");
        assertThat(report.factors()).hasSize(2);
        assertThat(report.factors().get(0).category()).isEqualTo("MARKET");
        assertThat(report.actionableAdvice()).hasSize(2);
    }
}
