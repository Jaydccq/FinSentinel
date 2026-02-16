package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "app.polygon")
@Getter
@Setter
public class PolygonProperties {
    private String apiKey;
    private String baseUrl = "https://api.polygon.io";
}
