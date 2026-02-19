package com.example.finsentinel.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Defines configuration beans for jackson config related components.
 *
 * <p>This class is part of the config layer in FinSentinel.
 */

@Configuration
public class JacksonConfig {

    /**
     * Executes object mapper.
     *
     * <p>This method belongs to {@link JacksonConfig} and encapsulates the
     * object mapper workflow.
     * @return the object mapper result (ObjectMapper)
     */

    @Bean
    public ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        return mapper;
    }
}
