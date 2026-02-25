package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration properties for OpenBB data integration.
 *
 * <p>Binds to the {@code app.openbb} prefix and stores connection settings for
 * the OpenBB REST service plus optional provider-specific API credentials used
 * by OpenBB Public Data connectors.
 */
@Configuration
@ConfigurationProperties(prefix = "app.openbb")
@Getter
@Setter
public class OpenbbProperties {

    /**
     * Enables OpenBB integration endpoints.
     */
    private boolean enabled = false;

    /**
     * Base URL of the OpenBB API service.
     */
    private String baseUrl = "http://localhost:6900";

    /**
     * API prefix appended before route paths.
     */
    private String apiPrefix = "/api/v1";

    /**
     * Optional OpenBB platform API key (if your OpenBB deployment requires one).
     */
    private String apiKey;

    /**
     * Provider-specific credential values for OpenBB Public Data connectors.
     */
    private Credentials credentials = new Credentials();

    /**
     * Business-level route defaults for opinionated macro endpoints.
     */
    private Business business = new Business();

    @Getter
    @Setter
    public static class Credentials {
        private String blsApiKey;
        private String congressGovApiKey;
        private String cftcAppToken;
        private String fredApiKey;
        private String polygonApiKey;
        private String usEiaApiKey;
    }

    @Getter
    @Setter
    public static class Business {
        /**
         * Default provider for macro business endpoints.
         */
        private String macroProvider = "fred";

        /**
         * OpenBB route path for CPI data.
         */
        private String cpiPath = "economy/cpi";

        /**
         * OpenBB route path for unemployment data.
         */
        private String unemploymentPath = "economy/unemployment";

        /**
         * OpenBB route path for fed funds rate data.
         */
        private String fedFundsPath = "economy/federal_funds_rate";

        /**
         * Default FRED series IDs used by business endpoints.
         */
        private String cpiSeriesId = "CPIAUCSL";
        private String unemploymentSeriesId = "UNRATE";
        private String fedFundsSeriesId = "FEDFUNDS";
    }
}
