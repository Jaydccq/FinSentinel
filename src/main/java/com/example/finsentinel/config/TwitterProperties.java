package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "app.twitter-6551")
@Getter
@Setter
public class TwitterProperties {

    private boolean enabled = false;
    private String apiToken = "";
    private String baseUrl = "https://ai.6551.io";
    private int maxResults = 100;
    private int cacheTtlMinutes = 10;
}
