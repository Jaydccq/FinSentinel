package com.example.finsentinel.service.news;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.stereotype.Service;

@Service
@Slf4j
@RequiredArgsConstructor
public class NewsSentimentService {

    private final ChatModel chatModel;

    /**
     * Classifies news sentiment using the LLM.
     * Returns "POSITIVE", "NEGATIVE", or "NEUTRAL".
     * Defaults to "NEUTRAL" on any failure to never block the enrichment pipeline.
     */
    public String classify(String title, String summary) {
        try {
            String text = title + (summary != null ? " " + summary : "");
            String promptText = "Classify the sentiment of this financial news as exactly one word: POSITIVE, NEGATIVE, or NEUTRAL. " +
                    "Only respond with one of those three words, nothing else.\n\nNews: " + text;

            String response = chatModel.call(new Prompt(promptText))
                    .getResult()
                    .getOutput()
                    .getText()
                    .trim()
                    .toUpperCase();

            if (response.contains("POSITIVE")) return "POSITIVE";
            if (response.contains("NEGATIVE")) return "NEGATIVE";
            return "NEUTRAL";
        } catch (Exception e) {
            log.warn("Sentiment classification failed, defaulting to NEUTRAL: {}", e.getMessage());
            return "NEUTRAL";
        }
    }
}
