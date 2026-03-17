package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration properties for the research data provider abstraction layer.
 *
 * <p>Binds to the {@code app.research} prefix and controls which
 * {@link com.example.finsentinel.service.research.ResearchDataProvider} is used by default.
 *
 * <h4>Example {@code application.yml}:</h4>
 * <pre>{@code
 * app:
 *   research:
 *     default-provider: polygon
 * }</pre>
 */
@Configuration
@ConfigurationProperties(prefix = "app.research")
@Getter
@Setter
public class ResearchProperties {

    /**
     * Name of the default research data provider (must match
     * {@link com.example.finsentinel.service.research.ResearchDataProvider#getName()}).
     * Defaults to {@code "polygon"}.
     */
    private String defaultProvider = "polygon";
}
