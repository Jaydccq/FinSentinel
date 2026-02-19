package com.example.finsentinel.config;


import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Defines configuration beans for rag chunking properties related components.
 *
 * <p>This class belongs to the config layer in FinSentinel.
 */

@Configuration
@ConfigurationProperties(prefix = "app.rag.chunk")
@Getter
@Setter
public class RagChunkingProperties {
    private int chunkSize = 500;
    private int chunkOverlap = 50;
    private int minChunkSizeChars = 200;
    private int maxNumChunks = 10_000;
}
