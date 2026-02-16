package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "app.firecrawl")
@Getter
@Setter
public class FirecrawlProperties {
    private String apiKey;
    private String baseUrl = "https://api.firecrawl.dev/v2";
}
