package com.example.finsentinel.agent;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

/**
 * Dedicated service for one-click stock analysis.
 * Uses a lightweight ChatClient with only market-data tools,
 * no risk-assessment prompt, and no RiskReport output schema.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class StockAnalysisService {

    private final ChatClient stockAnalysisChatClient;

    /**
     * Stream a stock analysis for the given prompt.
     * The prompt should be the fully-resolved stock-analysis.st template.
     */
    public Flux<String> analyzeStream(String analysisPrompt) {
        log.info("Starting stock analysis stream, prompt length={}", analysisPrompt.length());
        return stockAnalysisChatClient.prompt()
                .user(analysisPrompt)
                .stream()
                .content();
    }
}
