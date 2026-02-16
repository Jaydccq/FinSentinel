package com.example.finsentinel.config;

/**
 *
 * @author HongxiChen
 * @version 1.0 2/16/26
 */

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

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
