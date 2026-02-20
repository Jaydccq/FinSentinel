package com.example.finsentinel.agent.advisor;

import com.example.finsentinel.config.ComplianceProperties;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
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
    private static final ObjectMapper objectMapper = tools.jackson.databind.json.JsonMapper.builder().build();

    private final ComplianceProperties complianceProperties;

    /**
     * Executes before.
     *
     * <p>This method belongs to {@link ComplianceGuardrailAdvisor} and encapsulates the
     * before workflow.
     * @param chatClientRequest chat client request (ChatClientRequest)
     * @param advisorChain advisor chain (AdvisorChain)
     * @return the before result (ChatClientRequest)
     */

    @Override
    public ChatClientRequest before(ChatClientRequest chatClientRequest, AdvisorChain advisorChain) {
        // No pre-processing needed — compliance is post-processing only
        return chatClientRequest;
    }

    /**
     * Executes after.
     *
     * <p>This method belongs to {@link ComplianceGuardrailAdvisor} and encapsulates the
     * after workflow.
     * @param chatClientResponse chat client response (ChatClientResponse)
     * @param advisorChain advisor chain (AdvisorChain)
     * @return the after result (ChatClientResponse)
     */

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

    /**
     * Returns order.
     *
     * <p>This method belongs to {@link ComplianceGuardrailAdvisor} and encapsulates the
     * get order workflow.
     * @return the get order result (int)
     */

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

    /**
     * Processes json report.
     *
     * <p>This method belongs to {@link ComplianceGuardrailAdvisor} and encapsulates the
     * process json report workflow.
     * @param root root (ObjectNode)
     * @return the process json report result (String)
     */

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

    /**
     * Executes scan for forbidden phrases.
     *
     * <p>This method belongs to {@link ComplianceGuardrailAdvisor} and encapsulates the
     * scan for forbidden phrases workflow.
     * @param root root (ObjectNode)
     * @param violations violations (List<String>)
     */

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

    /**
     * Executes ensure compliance note.
     *
     * <p>This method belongs to {@link ComplianceGuardrailAdvisor} and encapsulates the
     * ensure compliance note workflow.
     * @param root root (ObjectNode)
     * @param violations violations (List<String>)
     */

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

    /**
     * Executes enforce regulatory framework.
     *
     * <p>This method belongs to {@link ComplianceGuardrailAdvisor} and encapsulates the
     * enforce regulatory framework workflow.
     * @param root root (ObjectNode)
     */

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

    /**
     * Returns expected framework.
     *
     * <p>This method belongs to {@link ComplianceGuardrailAdvisor} and encapsulates the
     * get expected framework workflow.
     * @return the get expected framework result (String)
     */

    private String getExpectedFramework() {
        return switch (complianceProperties.getRegion()) {
            case "US" -> "SEC";
            case "UK" -> "FCA";
            case "EU" -> "ESMA";
            default -> "SEC";
        };
    }

    /**
     * Executes append disclaimer to plain text.
     *
     * <p>This method belongs to {@link ComplianceGuardrailAdvisor} and encapsulates the
     * append disclaimer to plain text workflow.
     * @param content content (String)
     * @return the append disclaimer to plain text result (String)
     */

    private String appendDisclaimerToPlainText(String content) {
        String disclaimer = complianceProperties.getDisclaimer();
        if (content.contains(disclaimer)) {
            return content;
        }
        return content + "\n\n---\nDisclaimer: " + disclaimer;
    }
}
