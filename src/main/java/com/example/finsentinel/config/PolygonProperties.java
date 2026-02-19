package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Defines configuration beans for polygon properties related components.
 *
 * <p>This class belongs to the config layer in FinSentinel.
 */

@Configuration
@ConfigurationProperties(prefix = "app.polygon")
@Getter
@Setter
public class PolygonProperties {
    private String apiKey;
    private String baseUrl = "https://api.polygon.io";
}
