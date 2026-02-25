package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.math.BigDecimal;

/**
 * Configuration for the agent confirmation gate.
 *
 * <p>{@code trade-amount-threshold} controls the dollar value above which the agent
 * must request confirmation before executing a trade. {@code block-live-mode}
 * prevents the agent from autonomously switching to LIVE trading mode.
 */
@Configuration
@ConfigurationProperties(prefix = "app.confirmation")
@Getter
@Setter
public class ConfirmationProperties {
    private BigDecimal tradeAmountThreshold = new BigDecimal("10000");
    private boolean blockLiveMode = true;
}
