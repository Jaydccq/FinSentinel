package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "app.compliance")
@Getter
@Setter
public class ComplianceProperties {
    private String region = "US";
    private String disclaimer;
}
