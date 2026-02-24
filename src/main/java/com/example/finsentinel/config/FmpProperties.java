package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration properties for the Financial Modeling Prep (FMP) market data provider.
 *
 * <p>Binds to the {@code app.fmp} prefix. FMP is disabled by default because it
 * requires a paid API key. Set {@code app.fmp.enabled=true} to activate the
 * {@link com.example.finsentinel.service.market.FmpMarketDataProvider} bean.
 *
 * <h4>Example {@code application.yml}:</h4>
 * <pre>{@code
 * app:
 *   fmp:
 *     api-key: ${FMP_API_KEY}
 *     base-url: https://financialmodelingprep.com/api/v3
 *     enabled: true
 * }</pre>
 */
@Configuration
@ConfigurationProperties(prefix = "app.fmp")
@Getter
@Setter
public class FmpProperties {

    /**
     * FMP API key. Required when {@code enabled} is {@code true}.
     */
    private String apiKey;

    /**
     * FMP API base URL. Defaults to the v3 REST endpoint.
     */
    private String baseUrl = "https://financialmodelingprep.com/api/v3";

    /**
     * Whether the FMP provider bean should be registered. Disabled by default
     * since a valid API key is required.
     */
    private boolean enabled = false;
}
