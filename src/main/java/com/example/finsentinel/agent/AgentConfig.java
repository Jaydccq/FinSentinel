package com.example.finsentinel.agent;

import com.example.finsentinel.agent.advisor.ComplianceGuardrailAdvisor;
import com.example.finsentinel.agent.tool.*;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.vectorstore.QuestionAnswerAdvisor;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;

/**
 * Implements AI agent logic for agent config workflows.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */

@Configuration
public class AgentConfig {

    @Value("classpath:prompts/system-prompt.st")
    private Resource systemPrompt;

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
     * @param questionAnswerAdvisor question answer advisor (QuestionAnswerAdvisor)
     * @param complianceGuardrailAdvisor compliance guardrail advisor (ComplianceGuardrailAdvisor)
     * @return the risk agent chat client result (ChatClient)
     */

    @Bean
    public ChatClient riskAgentChatClient(
            ChatModel chatModel,
            StockMarketTool stockMarketTool,
            NewsAnalysisTool newsAnalysisTool,
            TechnicalIndicatorTool technicalIndicatorTool,
            PortfolioAnalysisTool portfolioAnalysisTool,
            ComplianceCheckTool complianceCheckTool,
            QuestionAnswerAdvisor questionAnswerAdvisor,
            ComplianceGuardrailAdvisor complianceGuardrailAdvisor) {


        return ChatClient.builder(chatModel)
                .defaultSystem(systemPrompt)
                .defaultTools(stockMarketTool, newsAnalysisTool,
                        technicalIndicatorTool, portfolioAnalysisTool,
                        complianceCheckTool)
                .defaultAdvisors(questionAnswerAdvisor, complianceGuardrailAdvisor)
                .build();
    }
}
