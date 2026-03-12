package com.example.finsentinel.agent;

import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.model.RiskReportEntity;
import com.example.finsentinel.model.enums.RiskLevel;
import com.example.finsentinel.repository.RiskReportRepository;
import com.example.finsentinel.repository.PortfolioRepository;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Implements AI agent logic for risk agent service workflows.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */

@Service
@Slf4j
@RequiredArgsConstructor
public class RiskAgentService {

    private final ChatClient riskAgentChatClient;
    private final ChatModel chatModel;
    private final RiskReportRepository riskReportRepository;
    private final PortfolioRepository portfolioRepository;
    private final ObjectMapper objectMapper;

    @Value("classpath:prompts/risk-assessment.st")
    private Resource riskAssessmentPrompt;

    private record ParseOutcome(RiskReport report, boolean fallbackUsed) {}

    /**
     * Run a full risk assessment for a user query.
     *
     * <p>The LLM will autonomously call tools (StockMarketTool, TechnicalIndicatorTool, etc.)
     * and return a structured RiskReport. Tools execute exactly once during the
     * {@code .call().content()} phase; if the raw JSON cannot be parsed, a lightweight
     * LLM call (no tools) attempts to fix it before falling back to a minimal report.
     */
    public RiskReport assess(String userMessage, UUID portfolioId, UUID userId) {
        log.info("Starting risk assessment: query='{}', portfolio={}",
                truncate(userMessage, 80), portfolioId);

        String portfolioContext = portfolioId != null
                ? "- Use analyzePortfolio with portfolio ID: " + portfolioId
                : "";

        // Get raw response — tools execute ONCE here
        String rawResponse = riskAgentChatClient.prompt()
                .advisors(advisor -> advisor.param("userId", userId))
                .user(u -> u
                        .text(riskAssessmentPrompt)
                        .param("userQuery", userMessage)
                        .param("portfolioContext", portfolioContext))
                .call()
                .content();

        // Parse with retry — tools do NOT re-execute
        ParseOutcome parseOutcome = parseWithRetry(rawResponse);
        RiskReport report = parseOutcome.report();

        log.info("Risk assessment complete: score={}, level={}",
                report.riskScore(), report.riskLevel());

        if (portfolioId != null) {
            if (parseOutcome.fallbackUsed()) {
                log.warn("Skipping persistence for portfolio {}: parsed fallback report due to malformed model output", portfolioId);
            } else {
                try {
                    persistReport(report, portfolioId);
                } catch (RuntimeException e) {
                    log.warn("Report computed but persistence failed: {}", e.getMessage());
                }
            }
        }
        return report;
    }

    /**
     * Parse raw LLM output into a {@link RiskReport}, retrying with a lightweight
     * LLM call (no tools registered) if the initial parse fails.
     *
     * <p>Three-stage strategy:
     * <ol>
     *   <li>Direct {@code objectMapper.readValue()} on the raw string</li>
     *   <li>Ask the LLM to extract/fix JSON (ephemeral ChatClient, no tools)</li>
     *   <li>Return a minimal valid report so the caller never receives null</li>
     * </ol>
     */
    private ParseOutcome parseWithRetry(String rawResponse) {
        // First attempt: direct parse
        try {
            return new ParseOutcome(objectMapper.readValue(rawResponse, RiskReport.class), false);
        } catch (Exception e) {
            log.warn("Structured output parse failed, asking LLM to fix JSON: {}", e.getMessage());
        }

        // Second attempt: ask LLM to extract/fix JSON (no tools — lightweight call)
        try {
            String fixed = ChatClient.create(chatModel).prompt()
                    .user("The following text should be a valid JSON object conforming to the RiskReport schema " +
                          "(riskScore, riskLevel, summary, factors, actionableAdvice). " +
                          "Extract and return ONLY the valid JSON, fixing any formatting issues:\n\n" + rawResponse)
                    .call()
                    .content();
            return new ParseOutcome(objectMapper.readValue(fixed, RiskReport.class), false);
        } catch (Exception retryEx) {
            log.error("Parse retry also failed, returning minimal report", retryEx);
        }

        // Final fallback: return a minimal valid report
        return new ParseOutcome(buildFallbackReport(), true);
    }

    private RiskReport buildFallbackReport() {
        return new RiskReport(1, "LOW",
                "Risk assessment completed but output could not be parsed. Please try again.",
                java.util.List.of(),
                java.util.List.of("Retry your query for a structured risk report."));
    }

    /**
     * Stream-based risk assessment for SSE endpoints.

     * Returns the raw text stream (not structured output).
     */
    public reactor.core.publisher.Flux<String> assessStream(String userMessage, UUID portfolioId, UUID userId) {
        String portfolioContext = portfolioId != null
                ? "- Use analyzePortfolio with portfolio ID: " + portfolioId
                : "";

        return riskAgentChatClient.prompt()
                .advisors(advisor -> advisor.param("userId", userId))
                .user(u -> u
                        .text(riskAssessmentPrompt)
                        .param("userQuery", userMessage)
                        .param("portfolioContext", portfolioContext))
                .stream()
                .content();
    }

    /**
     * Lightweight synchronous LLM call without tools or advisors.
     * Used for simple text-in / text-out tasks like news summarization.
     */
    public String quickChat(String prompt) {
        return ChatClient.create(chatModel).prompt()
                .user(prompt)
                .call()
                .content();
    }

    /**
     * Executes persist report.
     *
     * <p>This method belongs to {@link RiskAgentService} and encapsulates the
     * persist report workflow.
     * @param report report (RiskReport)
     * @param portfolioId portfolio id (UUID)
     */

    private void persistReport(RiskReport report, UUID portfolioId) {
        var portfolio = portfolioRepository.findById(portfolioId).orElse(null);
        if (portfolio == null) {
            log.warn("Cannot persist report: portfolio {} not found", portfolioId);
            return;
        }

        try {
            RiskLevel level;
            try {
                String rawLevel = report.riskLevel();
                if (rawLevel == null || rawLevel.isBlank()) {
                    throw new IllegalArgumentException("Missing risk level");
                }
                level = RiskLevel.valueOf(rawLevel.toUpperCase().trim());
            } catch (IllegalArgumentException | NullPointerException e) {
                log.warn("Unknown risk level '{}' from LLM, defaulting to MEDIUM", report.riskLevel());
                level = RiskLevel.MEDIUM;
            }

            RiskReportEntity entity = RiskReportEntity.builder()
                    .portfolio(portfolio)
                    .riskScore(report.riskScore())
                    .riskLevel(level)
                    .summary(report.summary())
                    .factorsJson(objectMapper.writeValueAsString(report.factors()))
                    .adviceJson(objectMapper.writeValueAsString(report.actionableAdvice()))
                    .build();
            riskReportRepository.save(entity);
            log.info("Persisted risk report for portfolio {}", portfolioId);
        } catch (Exception e) {
            // Rethrow so the caller knows persistence failed — the report was already
            // computed successfully and returned, but history won't be available.
            throw new RuntimeException("Failed to persist risk report for portfolio " + portfolioId, e);
        }
    }

    /**
     * Executes truncate.
     *
     * <p>This method belongs to {@link RiskAgentService} and encapsulates the
     * truncate workflow.
     * @param text text (String)
     * @param maxLen max len (int)
     * @return the truncate result (String)
     */

    private String truncate(String text, int maxLen) {

        return text.length() <= maxLen ? text : text.substring(0, maxLen) + "...";
    }
}
