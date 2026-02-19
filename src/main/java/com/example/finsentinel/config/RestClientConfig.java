package com.example.finsentinel.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * Defines configuration beans for rest client config related components.
 *
 * <p>This class is part of the config layer in FinSentinel.
 */

@Configuration
public class RestClientConfig {

    /**
     * Executes rest client.
     *
     * <p>This method belongs to {@link RestClientConfig} and encapsulates the
     * rest client workflow.
     * @return the rest client result (RestClient)
     */

    @Bean
    public RestClient restClient() {

        return RestClient.builder()
                .build();
    }
}
