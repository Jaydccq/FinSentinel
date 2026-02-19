package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "app.archival")
@Getter
@Setter
public class ArchivalProperties {
    private boolean enabled = false;
    private int retentionDays = 7;
    private int failedRetentionDays = 3;
    private String cron = "0 0 2 * * *";
    private int batchSize = 50;
}
