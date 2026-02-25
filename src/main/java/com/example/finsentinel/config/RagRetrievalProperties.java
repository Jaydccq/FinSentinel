package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "app.rag.retrieval")
@Getter
@Setter
public class RagRetrievalProperties {
    /** Default number of chunks to retrieve */
    private int defaultTopK = 5;
    /** Minimum cosine similarity to consider a hit relevant (unified for service + advisor) */
    private double similarityThreshold = 0.65;
    /** Maximum topK allowed (prevents abuse from tool calls) */
    private int maxTopK = 20;
    /** Enable LLM-based query rewrite for improved retrieval */
    private boolean queryRewriteEnabled = true;
    /** Max query length (chars) before skipping rewrite (long queries already embed well) */
    private int queryRewriteMaxLength = 80;
}
