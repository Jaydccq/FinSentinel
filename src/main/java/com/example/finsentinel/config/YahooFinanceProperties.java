package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration properties for the Yahoo Finance market data provider.
 *
 * <p>Binds to the {@code app.yahoo-finance} prefix. Yahoo Finance requires
 * no API key, making it the most accessible data source for any user.
 *
 * <h4>Example {@code application.yaml}:</h4>
 * <pre>{@code
 * app:
 *   yahoo-finance:
 *     enabled: true
 *     base-url: https://query1.finance.yahoo.com
 * }</pre>
 */
@Configuration
@ConfigurationProperties(prefix = "app.yahoo-finance")
@Getter
@Setter
public class YahooFinanceProperties {

    /**
     * Base URL for the Yahoo Finance v8 chart API.
     * Defaults to the public Yahoo Finance endpoint.
     */
    private String baseUrl = "https://query1.finance.yahoo.com";

    /**
     * Whether the Yahoo Finance provider is enabled.
     * Defaults to {@code true} since no API key is required.
     */
    private boolean enabled = true;
}
