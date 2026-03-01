package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * Configuration properties for OKX v5 exchange integration.
 *
 * <p>OKX requires 3 credentials (apiKey + secretKey + passphrase) unlike most
 * exchanges which only need 2. The passphrase is user-chosen during API key creation.
 *
 * <p>This class belongs to the config layer in FinSentinel.
 */
@Configuration
@ConfigurationProperties(prefix = "app.trading.okx")
@Getter
@Setter
public class OkxProperties {
    private boolean enabled = false;
    private String apiKey;
    private String secretKey;
    private String passphrase;
    private String baseUrl = "https://www.okx.com";
    private boolean sandbox = false;
    private boolean websocketEnabled = true;
    private String websocketUrl = "wss://ws.okx.com:8443/ws/v5";
    private List<String> watchPairs = List.of("BTC-USDT", "ETH-USDT", "SOL-USDT");
    private int rateLimitPerSecond = 10;
}
