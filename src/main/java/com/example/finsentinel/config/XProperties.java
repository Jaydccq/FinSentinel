package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
@ConfigurationProperties(prefix = "app.x")
@Getter
@Setter
public class XProperties {

    private boolean enabled = false;

    private String bearerToken;

    private String baseUrl = "https://api.x.com/2";

    private long pollInterval = 300000;

    private int maxResultsPerUser = 10;

    private List<String> influencers = List.of();
}
