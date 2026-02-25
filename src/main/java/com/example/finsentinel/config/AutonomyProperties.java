package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.math.BigDecimal;

/**
 * Configuration for autonomous scheduling and heartbeat behavior.
 */
@Configuration
@ConfigurationProperties(prefix = "app.autonomy")
@Getter
@Setter
public class AutonomyProperties {

    private int maxSchedulesPerUser = 20;
    private Heartbeat heartbeat = new Heartbeat();

    @Getter
    @Setter
    public static class Heartbeat {
        private boolean enabled = true;
        private long dispatcherIntervalMs = 30_000;
        private int defaultIntervalSeconds = 600;
        private int minIntervalSeconds = 60;
        private int maxIntervalSeconds = 3600;
        private BigDecimal defaultDrawdownAlertPct = new BigDecimal("10.00");
    }
}
