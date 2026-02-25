package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration for long conversation context compaction.
 */
@Configuration
@ConfigurationProperties(prefix = "app.chat.compaction")
@Getter
@Setter
public class ChatCompactionProperties {
    private boolean enabled = true;
    private int thresholdMessages = 24;
    private int recentWindow = 10;
    private int maxSummaryChars = 1200;
}
