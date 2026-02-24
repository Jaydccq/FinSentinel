package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration properties for the market data provider abstraction layer.
 *
 * <p>Binds to the {@code app.market} prefix and controls which
 * {@link com.example.finsentinel.service.market.MarketDataProvider} is used by default.
 *
 * <h4>Example {@code application.yml}:</h4>
 * <pre>{@code
 * app:
 *   market:
 *     default-provider: polygon
 * }</pre>
 */
@Configuration
@ConfigurationProperties(prefix = "app.market")
@Getter
@Setter
public class MarketProperties {

    /**
     * Name of the default market data provider (must match
     * {@link com.example.finsentinel.service.market.MarketDataProvider#getName()}).
     * Defaults to {@code "polygon"}.
     */
    private String defaultProvider = "polygon";
}
