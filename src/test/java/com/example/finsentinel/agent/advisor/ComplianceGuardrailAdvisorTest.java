package com.example.finsentinel.agent.advisor;

import com.example.finsentinel.config.ComplianceProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.AdvisorChain;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * Implements AI agent logic for compliance guardrail advisor test workflows.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */

class ComplianceGuardrailAdvisorTest {

    private ComplianceGuardrailAdvisor advisor;
    private ComplianceProperties complianceProperties;
    private AdvisorChain advisorChain;


    @BeforeEach
    void setUp() {
        complianceProperties = new ComplianceProperties();
        complianceProperties.setRegion("US");
        complianceProperties.setDisclaimer(
                "This is AI-generated analysis for informational purposes only. "
                + "It does not constitute investment advice.");
        complianceProperties.setForbiddenPhrases(List.of(
                "you should buy", "I recommend buying", "guaranteed returns",
                "risk-free", "you must invest", "buy now"
        ));
        advisor = new ComplianceGuardrailAdvisor(complianceProperties);
        advisorChain = mock(AdvisorChain.class);
    }


    @Test
    void after_shouldAppendDisclaimerWhenMissing() {
        String content = """
                {"riskScore":45,"riskLevel":"MEDIUM","summary":"Moderate risk.",\
                "factors":[],"actionableAdvice":[],"complianceNote":null}""";
        ChatClientResponse response = buildResponse(content);

        ChatClientResponse result = advisor.after(response, advisorChain);

        String text = extractText(result);
        assertThat(text).contains("complianceNote");
        assertThat(text).contains("does not constitute investment advice");
    }


    @Test
    void after_shouldFlagViolationForForbiddenPhrases() {
        String content = """
                {"riskScore":30,"riskLevel":"MEDIUM","summary":"You should buy AAPL now.",\
                "factors":[],"actionableAdvice":["Buy now for guaranteed returns"],\
                "complianceNote":{"disclaimer":"AI analysis.","regulatoryFramework":"SEC","isCompliant":true}}""";
        ChatClientResponse response = buildResponse(content);

        ChatClientResponse result = advisor.after(response, advisorChain);

        String text = extractText(result);
        assertThat(text).contains("\"isCompliant\":false").as("Should mark non-compliant when forbidden phrases found");
    }


    @Test
    void after_shouldPassCleanReportUnchanged() {
        String content = """
                {"riskScore":50,"riskLevel":"HIGH","summary":"Elevated risk due to market volatility.",\
                "factors":[{"category":"MARKET","score":60,"description":"Broad uncertainty"}],\
                "actionableAdvice":["Consider diversifying into defensive sectors"],\
                "complianceNote":{"disclaimer":"This is AI-generated analysis for informational purposes only. It does not constitute investment advice.","regulatoryFramework":"SEC","isCompliant":true}}""";
        ChatClientResponse response = buildResponse(content);

        ChatClientResponse result = advisor.after(response, advisorChain);

        String text = extractText(result);
        assertThat(text).contains("\"isCompliant\":true");
        assertThat(text).contains("\"regulatoryFramework\":\"SEC\"");
    }


    @Test
    void after_shouldEnforceCorrectRegulatoryFramework() {
        String content = """
                {"riskScore":40,"riskLevel":"MEDIUM","summary":"Analysis complete.",\
                "factors":[],"actionableAdvice":[],\
                "complianceNote":{"disclaimer":"AI analysis.","regulatoryFramework":"FCA","isCompliant":true}}""";
        ChatClientResponse response = buildResponse(content);

        ChatClientResponse result = advisor.after(response, advisorChain);

        String text = extractText(result);
        assertThat(text).contains("\"regulatoryFramework\":\"SEC\"")
                .as("Should override regulatory framework to match configured region");
    }


    @Test
    void after_shouldHandleNonJsonResponseGracefully() {
        String content = "This is a plain text response that is not JSON.";
        ChatClientResponse response = buildResponse(content);

        ChatClientResponse result = advisor.after(response, advisorChain);

        String text = extractText(result);
        assertThat(text).contains("does not constitute investment advice");
    }


    @Test
    void processContent_shouldDetectMultipleForbiddenPhrases() {
        String content = """
                {"riskScore":30,"riskLevel":"MEDIUM","summary":"This is risk-free and guaranteed returns.",\
                "factors":[],"actionableAdvice":[],\
                "complianceNote":{"disclaimer":"Disclaimer.","regulatoryFramework":"SEC","isCompliant":true}}""";

        String result = advisor.processContent(content);

        assertThat(result).contains("\"isCompliant\":false");
    }


    @Test
    void getOrder_shouldReturnLowPriorityForPostProcessing() {
        assertThat(advisor.getOrder()).isGreaterThan(0)
                .as("Compliance advisor should run after other advisors (higher order = later)");
    }

    /**
     * Builds response.
     *
     * <p>This method belongs to {@link ComplianceGuardrailAdvisorTest} and encapsulates the
     * build response workflow.
     * @param content content (String)
     * @return the build response result (ChatClientResponse)
     */

    private ChatClientResponse buildResponse(String content) {
        AssistantMessage assistantMessage = new AssistantMessage(content);
        Generation generation = new Generation(assistantMessage);
        ChatResponse chatResponse = new ChatResponse(List.of(generation));

        return ChatClientResponse.builder()
                .chatResponse(chatResponse)
                .build();
    }

    /**
     * Executes extract text.
     *
     * <p>This method belongs to {@link ComplianceGuardrailAdvisorTest} and encapsulates the
     * extract text workflow.
     * @param response response (ChatClientResponse)
     * @return the extract text result (String)
     */

    private String extractText(ChatClientResponse response) {

        return response.chatResponse().getResult().getOutput().getText();
    }
}
