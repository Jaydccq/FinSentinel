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

@Configuration
public class AgentConfig {

    @Value("classpath:prompts/system-prompt.st")
    private Resource systemPrompt;

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
