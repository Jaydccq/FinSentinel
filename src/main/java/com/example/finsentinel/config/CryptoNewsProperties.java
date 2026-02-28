package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
@ConfigurationProperties(prefix = "app.crypto-news")
@Getter
@Setter
public class CryptoNewsProperties {

    private boolean enabled = false;
    private String apiToken = "";
    private String baseUrl = "https://ai.6551.io";
    private int pollIntervalMs = 300000;
    private int minAiScore = 70;
    private int maxResultsPerFetch = 30;
    private List<String> watchCoins = List.of("BTC", "ETH", "SOL");
}
