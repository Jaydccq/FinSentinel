package com.example.finsentinel.agent;

import com.example.finsentinel.config.ComplianceProperties;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.model.RiskReportEntity;
import com.example.finsentinel.model.enums.RiskLevel;
import com.example.finsentinel.repository.RiskReportRepository;
import com.example.finsentinel.repository.PortfolioRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class RiskAgentService {

    private final ChatClient riskAgentChatClient;
    private final ComplianceProperties complianceProperties;
    private final RiskReportRepository riskReportRepository;
    private final PortfolioRepository portfolioRepository;
    private final ObjectMapper objectMapper;

    /**
     * Run a full risk assessment for a user query.
     * The LLM will autonomously call tools (StockMarketTool, TechnicalIndicatorTool, etc.)
     * and return a structured RiskReport.
     */
    public RiskReport assess(String userMessage, UUID portfolioId) {
        log.info("Starting risk assessment: query='{}', portfolio={}",
                truncate(userMessage, 80), portfolioId);

        String prompt = buildPrompt(userMessage, portfolioId);

        RiskReport report = riskAgentChatClient.prompt()
                .user(prompt)
                .call()
                .entity(RiskReport.class);

        log.info("Risk assessment complete: score={}, level={}",
                report.riskScore(), report.riskLevel());

        if (portfolioId != null) {
            persistReport(report, portfolioId);
        }

        return report;
    }

    /**
     * Stream-based risk assessment for SSE endpoints.
     * Returns the raw text stream (not structured output).
     */
    public reactor.core.publisher.Flux<String> assessStream(String userMessage, UUID portfolioId) {
        String prompt = buildPrompt(userMessage, portfolioId);

        return riskAgentChatClient.prompt()
                .user(prompt)
                .stream()
                .content();
    }

    private String buildPrompt(String userMessage, UUID portfolioId) {
        StringBuilder prompt = new StringBuilder();
        prompt.append(userMessage);
        if (portfolioId != null) {
            prompt.append("\n\nPortfolio ID for analysis: ").append(portfolioId);
        }
        prompt.append("\n\nCompliance Region: ").append(complianceProperties.getRegion());
        return prompt.toString();
    }

    private void persistReport(RiskReport report, UUID portfolioId) {
        try {
            var portfolio = portfolioRepository.findById(portfolioId).orElse(null);
            if (portfolio == null) return;

            RiskReportEntity entity = RiskReportEntity.builder()
                    .portfolio(portfolio)
                    .riskScore(report.riskScore())
                    .riskLevel(RiskLevel.valueOf(report.riskLevel()))
                    .summary(report.summary())
                    .factorsJson(objectMapper.writeValueAsString(report.factors()))
                    .adviceJson(objectMapper.writeValueAsString(report.actionableAdvice()))
                    .disclaimer(report.complianceNote() != null ? report.complianceNote().disclaimer() : complianceProperties.getDisclaimer())
                    .regulatoryFramework(report.complianceNote() != null ? report.complianceNote().regulatoryFramework() : "SEC")
                    .build();
            riskReportRepository.save(entity);
            log.info("Persisted risk report for portfolio {}", portfolioId);
        } catch (Exception e) {
            log.error("Failed to persist risk report", e);
        }
    }

    private String truncate(String text, int maxLen) {
        return text.length() <= maxLen ? text : text.substring(0, maxLen) + "...";
    }
}
