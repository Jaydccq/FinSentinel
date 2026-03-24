package com.example.finsentinel.agent;

import com.example.finsentinel.agent.advisor.UserContextAdvisor;
import com.example.finsentinel.agent.tool.*;
import com.example.finsentinel.config.PersonaProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.vectorstore.QuestionAnswerAdvisor;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.beans.factory.ObjectProvider;
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
     * @param tradingTool trading tool (TradingTool) — @deprecated, kept for backward compat
     * @param unifiedTradingTool unified trading tool (UnifiedTradingTool) — replaces TradingTool
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
     * @param cryptoNewsToolProvider optional crypto news tool (CryptoNewsTool)
     * @param twitterToolProvider optional twitter tool (TwitterTool)
     * @param okxTradingToolProvider optional OKX trading tool — @deprecated, kept for backward compat
     * @param cryptoAnalyticsToolProvider optional crypto analytics tool (CryptoAnalyticsTool)
     * @param questionAnswerAdvisor question answer advisor (QuestionAnswerAdvisor)
     * @param userContextAdvisor user context advisor (UserContextAdvisor)
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
            TradingTool tradingTool, // @Deprecated — kept for backward compatibility during UTA transition
            UnifiedTradingTool unifiedTradingTool,
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
            ObjectProvider<CryptoNewsTool> cryptoNewsToolProvider,
            ObjectProvider<TwitterTool> twitterToolProvider,
            ObjectProvider<OkxTradingTool> okxTradingToolProvider, // @Deprecated — kept for backward compat
            ObjectProvider<CryptoAnalyticsTool> cryptoAnalyticsToolProvider,
            QuestionAnswerAdvisor questionAnswerAdvisor,
            UserContextAdvisor userContextAdvisor) {

        String personaPath = personaProperties.getPersonasDir() + personaProperties.getPersona() + ".st";
        Resource systemPrompt = resourceLoader.getResource(personaPath);

        var tools = new java.util.ArrayList<Object>(java.util.List.of(
                stockMarketTool, newsAnalysisTool, technicalIndicatorTool,
                portfolioAnalysisTool,
                tradingTool, // @Deprecated — remove after UTA migration complete
                unifiedTradingTool,
                brainTool,
                companyResearchTool, equityScreenerTool, quantAnalysisTool,
                thinkingTool, userProfileTool, confirmationTool, autonomyTool,
                marketCalendarTool, ownershipTool, shortInterestTool));

        CryptoNewsTool cryptoNewsTool = cryptoNewsToolProvider.getIfAvailable();
        if (cryptoNewsTool != null) tools.add(cryptoNewsTool);
        TwitterTool twitterTool = twitterToolProvider.getIfAvailable();
        if (twitterTool != null) tools.add(twitterTool);

        // @Deprecated — OkxTradingTool kept for backward compat; remove after UTA migration complete
        OkxTradingTool okxTradingTool = okxTradingToolProvider.getIfAvailable();
        if (okxTradingTool != null) tools.add(okxTradingTool);

        // CryptoAnalyticsTool — OKX-specific analytics (funding rates, composite positions, leverage)
        CryptoAnalyticsTool cryptoAnalyticsTool = cryptoAnalyticsToolProvider.getIfAvailable();
        if (cryptoAnalyticsTool != null) tools.add(cryptoAnalyticsTool);

        return ChatClient.builder(chatModel)
                .defaultSystem(systemPrompt)
                .defaultTools(tools.toArray())
                .defaultAdvisors(questionAnswerAdvisor, userContextAdvisor)
                .build();
    }

    /**
     * Lightweight ChatClient for stock analysis — uses only market-data tools,
     * no advisors, no risk-assessment prompt. Prevents dual-schema conflicts.
     */
    @Bean
    public ChatClient stockAnalysisChatClient(
            ChatModel chatModel,
            StockMarketTool stockMarketTool,
            TechnicalIndicatorTool technicalIndicatorTool,
            NewsAnalysisTool newsAnalysisTool,
            OwnershipTool ownershipTool,
            ShortInterestTool shortInterestTool) {

        return ChatClient.builder(chatModel)
                .defaultSystem("You are FinSentinel, an AI stock analyst. Follow the user's analysis instructions precisely. Output exactly one JSON block when instructed. Never output RiskReport schema.")
                .defaultTools(stockMarketTool, technicalIndicatorTool, newsAnalysisTool,
                        ownershipTool, shortInterestTool)
                .build();
    }
}
