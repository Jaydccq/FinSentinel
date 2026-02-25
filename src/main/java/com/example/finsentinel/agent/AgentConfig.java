package com.example.finsentinel.agent;

import com.example.finsentinel.agent.advisor.ComplianceGuardrailAdvisor;
import com.example.finsentinel.agent.advisor.UserContextAdvisor;
import com.example.finsentinel.agent.tool.*;
import com.example.finsentinel.config.PersonaProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.vectorstore.QuestionAnswerAdvisor;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;

/**
 * Implements AI agent logic for agent config workflows.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */

@Configuration
@RequiredArgsConstructor
public class AgentConfig {

    private final PersonaProperties personaProperties;

    /**
     * Executes risk agent chat client.
     *
     * <p>This method belongs to {@link AgentConfig} and encapsulates the
     * risk agent chat client workflow.
     * @param chatModel chat model (ChatModel)
     * @param stockMarketTool stock market tool (StockMarketTool)
     * @param newsAnalysisTool news analysis tool (NewsAnalysisTool)
     * @param technicalIndicatorTool technical indicator tool (TechnicalIndicatorTool)
     * @param portfolioAnalysisTool portfolio analysis tool (PortfolioAnalysisTool)
     * @param complianceCheckTool compliance check tool (ComplianceCheckTool)
     * @param tradingTool trading tool (TradingTool)
     * @param brainTool brain tool (BrainTool)
     * @param companyResearchTool company research tool (CompanyResearchTool)
     * @param equityScreenerTool equity screener tool (EquityScreenerTool)
     * @param quantAnalysisTool quant analysis tool (QuantAnalysisTool)
     * @param thinkingTool thinking tool (ThinkingTool)
     * @param userProfileTool user profile tool (UserProfileTool)
     * @param confirmationTool confirmation tool (ConfirmationTool)
     * @param autonomyTool autonomy tool (AutonomyTool)
     * @param marketCalendarTool market calendar tool (MarketCalendarTool)
     * @param ownershipTool ownership tool (OwnershipTool)
     * @param shortInterestTool short interest tool (ShortInterestTool)
     * @param questionAnswerAdvisor question answer advisor (QuestionAnswerAdvisor)
     * @param userContextAdvisor user context advisor (UserContextAdvisor)
     * @param complianceGuardrailAdvisor compliance guardrail advisor (ComplianceGuardrailAdvisor)
     * @return the risk agent chat client result (ChatClient)
     */

    @Bean
    public ChatClient riskAgentChatClient(
            ChatModel chatModel,
            ResourceLoader resourceLoader,
            StockMarketTool stockMarketTool,
            NewsAnalysisTool newsAnalysisTool,
            TechnicalIndicatorTool technicalIndicatorTool,
            PortfolioAnalysisTool portfolioAnalysisTool,
            ComplianceCheckTool complianceCheckTool,
            TradingTool tradingTool,
            BrainTool brainTool,
            CompanyResearchTool companyResearchTool,
            EquityScreenerTool equityScreenerTool,
            QuantAnalysisTool quantAnalysisTool,
            ThinkingTool thinkingTool,
            UserProfileTool userProfileTool,
            ConfirmationTool confirmationTool,
            AutonomyTool autonomyTool,
            MarketCalendarTool marketCalendarTool,
            OwnershipTool ownershipTool,
            ShortInterestTool shortInterestTool,
            QuestionAnswerAdvisor questionAnswerAdvisor,
            UserContextAdvisor userContextAdvisor,
            ComplianceGuardrailAdvisor complianceGuardrailAdvisor) {

        String personaPath = personaProperties.getPersonasDir() + personaProperties.getPersona() + ".st";
        Resource systemPrompt = resourceLoader.getResource(personaPath);

        return ChatClient.builder(chatModel)
                .defaultSystem(systemPrompt)
                .defaultTools(stockMarketTool, newsAnalysisTool,
                        technicalIndicatorTool, portfolioAnalysisTool,
                        complianceCheckTool, tradingTool, brainTool,
                        companyResearchTool, equityScreenerTool,
                        quantAnalysisTool, thinkingTool, userProfileTool,
                        confirmationTool, autonomyTool,
                        marketCalendarTool, ownershipTool, shortInterestTool)
                .defaultAdvisors(questionAnswerAdvisor, userContextAdvisor, complianceGuardrailAdvisor)
                .build();
    }
}
