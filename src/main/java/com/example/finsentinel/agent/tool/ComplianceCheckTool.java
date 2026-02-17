package com.example.finsentinel.agent.tool;

import com.example.finsentinel.config.ComplianceProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Function calling tool that the AI agent can invoke during synthesis
 * to validate a draft risk report against compliance rules before finalizing.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ComplianceCheckTool {

    private static final ObjectMapper objectMapper = new ObjectMapper();
    private final ComplianceProperties complianceProperties;

    @Tool(description = "Check a draft risk report JSON for compliance violations. "
            + "Returns COMPLIANT if the report passes all checks, or a list of VIOLATION entries with details. "
            + "Use this tool to validate your analysis before producing the final report.")
    public String checkCompliance(
            @ToolParam(description = "The draft risk report as a JSON string") String reportJson) {
        log.info("Running compliance check on draft report");

        try {
            JsonNode root = objectMapper.readTree(reportJson);
            List<String> violations = new ArrayList<>();

            checkForbiddenPhrases(root, violations);
            checkDisclaimer(root, violations);
            checkRiskScoreLevelConsistency(root, violations);
            checkRegulatoryFramework(root, violations);

            if (violations.isEmpty()) {
                return "COMPLIANT — Report passes all compliance checks.";
            }

            StringBuilder sb = new StringBuilder();
            sb.append("VIOLATIONS FOUND (").append(violations.size()).append("):\n");
            for (int i = 0; i < violations.size(); i++) {
                sb.append("  VIOLATION ").append(i + 1).append(": ").append(violations.get(i)).append("\n");
            }
            sb.append("\nPlease fix these violations before finalizing the report.");
            return sb.toString();

        } catch (Exception e) {
            log.error("Failed to parse report JSON for compliance check", e);
            return "Error: Could not parse report JSON — " + e.getMessage();
        }
    }

    private void checkForbiddenPhrases(JsonNode root, List<String> violations) {
        List<String> forbiddenPhrases = complianceProperties.getForbiddenPhrases();
        if (forbiddenPhrases == null || forbiddenPhrases.isEmpty()) return;

        String fullText = root.toString().toLowerCase();
        for (String phrase : forbiddenPhrases) {
            if (fullText.contains(phrase.toLowerCase())) {
                violations.add("Forbidden investment advice phrase detected: '" + phrase + "'");
            }
        }
    }

    private void checkDisclaimer(JsonNode root, List<String> violations) {
        JsonNode noteNode = root.path("complianceNote");
        if (noteNode.isMissingNode() || noteNode.isNull()) {
            violations.add("Missing complianceNote — every report must include a disclaimer and regulatory framework");
            return;
        }

        JsonNode disclaimerNode = noteNode.path("disclaimer");
        if (disclaimerNode.isMissingNode() || disclaimerNode.asText().isBlank()) {
            violations.add("Missing or empty disclaimer in complianceNote");
        }
    }

    private void checkRiskScoreLevelConsistency(JsonNode root, List<String> violations) {
        JsonNode scoreNode = root.path("riskScore");
        JsonNode levelNode = root.path("riskLevel");

        if (scoreNode.isMissingNode() || levelNode.isMissingNode()) return;

        int score = scoreNode.asInt();
        String level = levelNode.asText();

        String expectedLevel;
        if (score >= 1 && score <= 25) {
            expectedLevel = "LOW";
        } else if (score >= 26 && score <= 50) {
            expectedLevel = "MEDIUM";
        } else if (score >= 51 && score <= 75) {
            expectedLevel = "HIGH";
        } else if (score >= 76 && score <= 100) {
            expectedLevel = "CRITICAL";
        } else {
            expectedLevel = "UNKNOWN";
        }

        if (!expectedLevel.equals(level)) {
            violations.add("Risk score/level mismatch — score " + score
                    + " should map to " + expectedLevel + " but found " + level);
        }
    }

    private void checkRegulatoryFramework(JsonNode root, List<String> violations) {
        JsonNode noteNode = root.path("complianceNote");
        if (noteNode.isMissingNode() || noteNode.isNull()) return;

        JsonNode frameworkNode = noteNode.path("regulatoryFramework");
        String expected = getExpectedFramework();

        if (!frameworkNode.isMissingNode() && !frameworkNode.asText().equals(expected)) {
            violations.add("Regulatory framework should be '" + expected
                    + "' for region " + complianceProperties.getRegion()
                    + " but found '" + frameworkNode.asText() + "'");
        }
    }

    private String getExpectedFramework() {
        return switch (complianceProperties.getRegion()) {
            case "US" -> "SEC";
            case "UK" -> "FCA";
            case "EU" -> "ESMA";
            default -> "SEC";
        };
    }
}
