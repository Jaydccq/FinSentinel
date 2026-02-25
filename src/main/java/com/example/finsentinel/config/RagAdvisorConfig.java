package com.example.finsentinel.config;

import org.springframework.ai.chat.client.advisor.vectorstore.QuestionAnswerAdvisor;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**

 * Configuration for RAG (Retrieval-Augmented Generation) advisor.
 * Sets up QuestionAnswerAdvisor with pgvector for semantic search
 * in financial regulatory documents, market analysis, and SEC filings.
 */
@Configuration
public class RagAdvisorConfig {

    /**
     * Creates a QuestionAnswerAdvisor bean for RAG retrieval.

     * Uses pgvector with HNSW index (configured in application.yaml).
     * TopK and similarity threshold are driven by {@link RagRetrievalProperties}.
     *
     * @param vectorStore the pgvector-backed VectorStore (auto-configured by Spring AI)
     * @param ragProps    externalized retrieval parameters
     * @return QuestionAnswerAdvisor configured from application properties
     */
    @Bean
    public QuestionAnswerAdvisor questionAnswerAdvisor(VectorStore vectorStore,
                                                       RagRetrievalProperties ragProps) {

        return QuestionAnswerAdvisor.builder(vectorStore)
                .searchRequest(SearchRequest.builder()
                        .topK(ragProps.getDefaultTopK())
                        .similarityThreshold(ragProps.getSimilarityThreshold())
                        .build())
                .build();
    }
}
