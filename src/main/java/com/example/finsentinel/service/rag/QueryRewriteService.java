package com.example.finsentinel.service.rag;

import com.example.finsentinel.config.RagRetrievalProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@RequiredArgsConstructor
public class QueryRewriteService {

    private final ChatModel chatModel;
    private final RagRetrievalProperties ragProps;

    private static final String REWRITE_PROMPT = """
            You are a financial search query optimizer. Given a user's question about investments,
            rewrite it as a concise, keyword-rich search query optimized for semantic search
            against a knowledge base of SEC filings, research reports, and financial news.

            Rules:
            - Output ONLY the rewritten query, nothing else (no explanation, no quotes)
            - Expand ticker symbols to include company name (e.g. "AAPL" → "Apple AAPL stock")
            - Add relevant financial domain terms (e.g. "risk" → "risk analysis volatility downside")
            - Keep it under 200 characters
            - If the original query is already detailed (>60 chars), return it unchanged

            User query: %s
            """;

    /**
     * Rewrites a user query for better RAG retrieval quality.
     * Returns the original query if rewrite is disabled, query is already detailed, or LLM call fails.
     */
    public String rewrite(String query) {
        if (!ragProps.isQueryRewriteEnabled()) {
            return query;
        }
        if (query == null || query.isBlank()) {
            return query;
        }
        if (query.trim().length() > ragProps.getQueryRewriteMaxLength()) {
            log.debug("Query rewrite skipped: already detailed ({} chars)", query.length());
            return query;
        }

        try {
            String rewritten = ChatClient.create(chatModel).prompt()
                    .user(String.format(REWRITE_PROMPT, query))
                    .call()
                    .content();

            if (rewritten == null || rewritten.isBlank()) {
                return query;
            }

            rewritten = rewritten.trim();
            if (rewritten.length() < query.trim().length()) {
                log.debug("Query rewrite produced shorter result, using original");
                return query;
            }

            log.info("Query rewrite: '{}' → '{}'", query, rewritten);
            return rewritten;
        } catch (Exception e) {
            log.warn("Query rewrite failed, using original: {}", e.getMessage());
            return query;
        }
    }
}
