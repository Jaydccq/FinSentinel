package com.example.finsentinel.agent;

import com.example.finsentinel.config.ComplianceProperties;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.model.RiskReportEntity;
import com.example.finsentinel.model.enums.RiskLevel;
import com.example.finsentinel.repository.RiskReportRepository;
import com.example.finsentinel.repository.PortfolioRepository;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
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
    private final ComplianceProperties complianceProperties;
    private final RiskReportRepository riskReportRepository;
    private final PortfolioRepository portfolioRepository;
    private final ObjectMapper objectMapper;

    @Value("classpath:prompts/risk-assessment.st")
    private Resource riskAssessmentPrompt;

    /**
     * Run a full risk assessment for a user query.

     * The LLM will autonomously call tools (StockMarketTool, TechnicalIndicatorTool, etc.)
     * and return a structured RiskReport.
     */
    public RiskReport assess(String userMessage, UUID portfolioId) {
        log.info("Starting risk assessment: query='{}', portfolio={}",
                truncate(userMessage, 80), portfolioId);

        String portfolioContext = portfolioId != null
                ? "- Use analyzePortfolio with portfolio ID: " + portfolioId
                : "";

        RiskReport report = riskAgentChatClient.prompt()
                .system(sp -> sp
                        .param("complianceRegion", complianceProperties.getRegion())
                        .param("disclaimer", complianceProperties.getDisclaimer()))
                .user(u -> u
                        .text(riskAssessmentPrompt)
                        .param("userQuery", userMessage)
                        .param("portfolioContext", portfolioContext)
                        .param("complianceRegion", complianceProperties.getRegion()))
                .call()
                .entity(RiskReport.class);

        log.info("Risk assessment complete: score={}, level={}",
                report.riskScore(), report.riskLevel());

        if (portfolioId != null) {
            try {
                persistReport(report, portfolioId);
            } catch (RuntimeException e) {
                log.warn("Report computed successfully but persistence failed — " +
                        "report will not appear in history: {}", e.getMessage());
            }
        }

        return report;
    }

    /**
     * Stream-based risk assessment for SSE endpoints.

     * Returns the raw text stream (not structured output).
     */
    public reactor.core.publisher.Flux<String> assessStream(String userMessage, UUID portfolioId) {
        String portfolioContext = portfolioId != null
                ? "- Use analyzePortfolio with portfolio ID: " + portfolioId
                : "";

        return riskAgentChatClient.prompt()
                .system(sp -> sp
                        .param("complianceRegion", complianceProperties.getRegion())
                        .param("disclaimer", complianceProperties.getDisclaimer()))
                .user(u -> u
                        .text(riskAssessmentPrompt)
                        .param("userQuery", userMessage)
                        .param("portfolioContext", portfolioContext)
                        .param("complianceRegion", complianceProperties.getRegion()))
                .stream()
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
                level = RiskLevel.valueOf(report.riskLevel().toUpperCase().trim());
            } catch (IllegalArgumentException e) {
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
                    .disclaimer(report.complianceNote() != null ? report.complianceNote().disclaimer() : complianceProperties.getDisclaimer())
                    .regulatoryFramework(report.complianceNote() != null ? report.complianceNote().regulatoryFramework() : "SEC")
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
