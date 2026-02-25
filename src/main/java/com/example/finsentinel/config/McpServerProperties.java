package com.example.finsentinel.config;

import jakarta.annotation.PostConstruct;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;

import java.util.UUID;

/**
 * Configuration for the MCP (Model Context Protocol) server endpoint.
 *
 * <p>{@code enabled} gates the entire MCP filter chain and tool registration.
 * {@code api-key} authenticates external MCP clients via the {@code X-API-Key} header.
 * {@code user-id} maps authenticated MCP requests to an existing FinSentinel user
 * so that {@code SecurityUtils.getCurrentUserId()} works transparently.
 *
 * <p>When {@code enabled=true}, both {@code api-key} and {@code user-id} must be
 * non-blank with {@code user-id} being a valid UUID — validated at startup via
 * {@link #validate()}.
 */
@Configuration
@ConfigurationProperties(prefix = "app.mcp")
@Getter
@Setter
public class McpServerProperties {
    private boolean enabled = false;
    private String apiKey = "";
    private String userId = "";

    @PostConstruct
    void validate() {
        if (!enabled) {
            return;
        }
        if (!StringUtils.hasText(apiKey)) {
            throw new IllegalStateException(
                    "app.mcp.api-key must be set when app.mcp.enabled=true (env: MCP_API_KEY)");
        }
        if (!StringUtils.hasText(userId)) {
            throw new IllegalStateException(
                    "app.mcp.user-id must be set when app.mcp.enabled=true (env: MCP_USER_ID)");
        }
        try {
            UUID.fromString(userId);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(
                    "app.mcp.user-id must be a valid UUID, got: " + userId, e);
        }
    }

    public UUID getUserIdAsUUID() {
        return UUID.fromString(userId);
    }
}
