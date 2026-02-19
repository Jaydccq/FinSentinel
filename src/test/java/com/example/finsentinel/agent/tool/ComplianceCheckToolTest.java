package com.example.finsentinel.agent.tool;

import com.example.finsentinel.config.ComplianceProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Implements AI agent logic for compliance check tool test workflows.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */

class ComplianceCheckToolTest {

    private ComplianceCheckTool tool;


    @BeforeEach
    void setUp() {
        ComplianceProperties props = new ComplianceProperties();
        props.setRegion("US");
        props.setDisclaimer("AI-generated analysis. Not investment advice.");
        props.setForbiddenPhrases(List.of(
                "you should buy", "I recommend buying", "guaranteed returns",
                "risk-free", "you must invest", "buy now"
        ));
        tool = new ComplianceCheckTool(props);
    }


    @Test
    void checkCompliance_shouldPassCleanReport() {
        String reportJson = """
                {"riskScore":55,"riskLevel":"HIGH","summary":"Elevated risk due to volatility.",\
                "factors":[{"category":"MARKET","score":55,"description":"Market downturn risk"}],\
                "actionableAdvice":["Consider hedging with put options"],\
                "complianceNote":{"disclaimer":"AI-generated. Not investment advice.","regulatoryFramework":"SEC","isCompliant":true}}""";

        String result = tool.checkCompliance(reportJson);

        assertThat(result).contains("COMPLIANT");
        assertThat(result).doesNotContain("VIOLATION");
    }


    @Test
    void checkCompliance_shouldDetectForbiddenPhrases() {
        String reportJson = """
                {"riskScore":30,"riskLevel":"MEDIUM","summary":"You should buy AAPL immediately.",\
                "factors":[],"actionableAdvice":["Buy now for guaranteed returns"],\
                "complianceNote":{"disclaimer":"Disclaimer.","regulatoryFramework":"SEC","isCompliant":true}}""";

        String result = tool.checkCompliance(reportJson);

        assertThat(result).contains("VIOLATION");
        assertThat(result).containsIgnoringCase("you should buy");
        assertThat(result).containsIgnoringCase("buy now");
        assertThat(result).containsIgnoringCase("guaranteed returns");
    }


    @Test
    void checkCompliance_shouldDetectMissingDisclaimer() {
        String reportJson = """
                {"riskScore":50,"riskLevel":"HIGH","summary":"Analysis complete.",\
                "factors":[],"actionableAdvice":[],\
                "complianceNote":null}""";

        String result = tool.checkCompliance(reportJson);

        assertThat(result).contains("VIOLATION");
        assertThat(result).containsIgnoringCase("disclaimer");
    }


    @Test
    void checkCompliance_shouldDetectRiskScoreLevelMismatch() {
        String reportJson = """
                {"riskScore":80,"riskLevel":"LOW","summary":"Low risk despite high score.",\
                "factors":[],"actionableAdvice":[],\
                "complianceNote":{"disclaimer":"AI analysis.","regulatoryFramework":"SEC","isCompliant":true}}""";

        String result = tool.checkCompliance(reportJson);

        assertThat(result).contains("VIOLATION");
        assertThat(result).containsIgnoringCase("mismatch");
    }


    @Test
    void checkCompliance_shouldHandleInvalidJson() {
        String result = tool.checkCompliance("not valid json {{{");

        assertThat(result).contains("Error");
    }
}
