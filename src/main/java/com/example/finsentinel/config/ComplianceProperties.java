package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
@ConfigurationProperties(prefix = "app.compliance")
@Getter
@Setter
public class ComplianceProperties {
    private String region = "US";
    private String disclaimer;
    private List<String> forbiddenPhrases = List.of(
            "you should buy", "I recommend buying", "guaranteed returns",
            "risk-free", "you must invest", "buy now",
            "sure thing", "can't lose", "100% safe"
    );
}
