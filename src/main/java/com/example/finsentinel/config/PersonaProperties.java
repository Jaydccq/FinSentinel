package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "app.agent")
@Getter
@Setter
public class PersonaProperties {
    private String persona = "default";
    private String personasDir = "classpath:prompts/personas/";
}
