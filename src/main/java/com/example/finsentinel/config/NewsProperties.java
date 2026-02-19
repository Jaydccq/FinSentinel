package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
@ConfigurationProperties(prefix = "app.news")
@Getter
@Setter
public class NewsProperties {

    private boolean enabled = true;

    private long pollInterval = 60000;

    private long rssPollInterval = 120000;

    private List<String> watchTickers = List.of("AAPL", "MSFT", "GOOGL", "TSLA", "JPM", "NVDA");

    private List<RssFeedConfig> rssFeeds = List.of();

    private int retentionDays = 30;

    private EnrichConfig enrich = new EnrichConfig();

    @Getter
    @Setter
    public static class RssFeedConfig {
        private String name;
        private String url;
        private String source;
    }

    @Getter
    @Setter
    public static class EnrichConfig {
        private boolean enabled = true;
        private int batchSize = 5;
    }
}
