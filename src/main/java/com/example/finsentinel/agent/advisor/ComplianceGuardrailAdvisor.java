package com.example.finsentinel.agent.advisor;

import com.example.finsentinel.config.ComplianceProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.AdvisorChain;
import org.springframework.ai.chat.client.advisor.api.BaseAdvisor;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Post-processing advisor that validates and enforces compliance rules on every AI response.
 * Runs after the LLM generates output to:
 * 1. Scan for forbidden investment advice phrases
 * 2. Validate/inject ComplianceNote with correct disclaimer and regulatory framework
 * 3. Set isCompliant=false when violations are detected
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ComplianceGuardrailAdvisor implements BaseAdvisor {

    private static final int ORDER = 1000; // Run after RAG advisor (lower order = higher priority)
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final ComplianceProperties complianceProperties;

    @Override
    public ChatClientRequest before(ChatClientRequest chatClientRequest, AdvisorChain advisorChain) {
        // No pre-processing needed — compliance is post-processing only
        return chatClientRequest;
    }

    @Override
    public ChatClientResponse after(ChatClientResponse chatClientResponse, AdvisorChain advisorChain) {
        ChatResponse chatResponse = chatClientResponse.chatResponse();
        if (chatResponse == null || chatResponse.getResult() == null) {
            return chatClientResponse;
        }

        String content = chatResponse.getResult().getOutput().getText();
        if (content == null || content.isBlank()) {
            return chatClientResponse;
        }

        String processed = processContent(content);
        if (processed.equals(content)) {
            return chatClientResponse;
        }

        // Build a new ChatClientResponse with modified content, preserving context
        AssistantMessage newMessage = new AssistantMessage(processed);
        Generation newGeneration = new Generation(newMessage);
        ChatResponse newChatResponse = new ChatResponse(List.of(newGeneration));

        return chatClientResponse.mutate()
                .chatResponse(newChatResponse)
                .build();
    }

    @Override
    public int getOrder() {
        return ORDER;
    }

    String processContent(String content) {
        try {
            JsonNode root = objectMapper.readTree(content);
            if (!root.isObject()) {
                return appendDisclaimerToPlainText(content);
            }
            return processJsonReport((ObjectNode) root);
        } catch (Exception e) {
            // Not valid JSON — append disclaimer to plain text
            return appendDisclaimerToPlainText(content);
        }
    }

    private String processJsonReport(ObjectNode root) {
        List<String> violations = new ArrayList<>();

        // 1. Scan for forbidden phrases in summary and actionableAdvice
        scanForForbiddenPhrases(root, violations);

        // 2. Validate/fix ComplianceNote
        ensureComplianceNote(root, violations);

        // 3. Enforce regulatory framework
        enforceRegulatoryFramework(root);

        // 4. Set isCompliant based on violations
        if (!violations.isEmpty()) {
            log.warn("Compliance violations detected: {}", violations);
            ObjectNode note = (ObjectNode) root.get("complianceNote");
            if (note != null) {
                note.put("isCompliant", false);
            }
        }

        try {
            return objectMapper.writeValueAsString(root);
        } catch (Exception e) {
            log.error("Failed to serialize processed report", e);
            return root.toString();
        }
    }

    private void scanForForbiddenPhrases(ObjectNode root, List<String> violations) {
        List<String> forbiddenPhrases = complianceProperties.getForbiddenPhrases();
        if (forbiddenPhrases == null || forbiddenPhrases.isEmpty()) return;

        String fullText = root.toString().toLowerCase();
        for (String phrase : forbiddenPhrases) {
            if (fullText.contains(phrase.toLowerCase())) {
                violations.add("Forbidden phrase detected: '" + phrase + "'");
            }
        }
    }

    private void ensureComplianceNote(ObjectNode root, List<String> violations) {
        JsonNode noteNode = root.get("complianceNote");

        if (noteNode == null || noteNode.isNull()) {
            violations.add("Missing complianceNote — injecting default");
            ObjectNode note = objectMapper.createObjectNode();
            note.put("disclaimer", complianceProperties.getDisclaimer());
            note.put("regulatoryFramework", getExpectedFramework());
            note.put("isCompliant", true);
            root.set("complianceNote", note);
            return;
        }

        if (noteNode.isObject()) {
            ObjectNode note = (ObjectNode) noteNode;
            // Ensure disclaimer is present and adequate
            JsonNode disclaimerNode = note.get("disclaimer");
            if (disclaimerNode == null || disclaimerNode.asText().isBlank()) {
                violations.add("Empty disclaimer — injecting default");
                note.put("disclaimer", complianceProperties.getDisclaimer());
            }
        }
    }

    private void enforceRegulatoryFramework(ObjectNode root) {
        JsonNode noteNode = root.get("complianceNote");
        if (noteNode != null && noteNode.isObject()) {
            ObjectNode note = (ObjectNode) noteNode;
            String expected = getExpectedFramework();
            JsonNode frameworkNode = note.get("regulatoryFramework");
            if (frameworkNode == null || !frameworkNode.asText().equals(expected)) {
                log.info("Overriding regulatory framework from '{}' to '{}'",
                        frameworkNode != null ? frameworkNode.asText() : "null", expected);
                note.put("regulatoryFramework", expected);
            }
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

    private String appendDisclaimerToPlainText(String content) {
        String disclaimer = complianceProperties.getDisclaimer();
        if (content.contains(disclaimer)) {
            return content;
        }
        return content + "\n\n---\nDisclaimer: " + disclaimer;
    }
}
