package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration properties for AES-256-GCM encryption of stored API keys.
 *
 * <p>Binds to the {@code app.encryption} prefix. The AES key must be a
 * Base64-encoded 256-bit (32-byte) value. Generate with:
 * {@code openssl rand -base64 32}
 *
 * <p>This class belongs to the config layer in FinSentinel.
 */
@Configuration
@ConfigurationProperties(prefix = "app.encryption")
@Getter
@Setter
public class EncryptionProperties {

    /**
     * Base64-encoded AES-256 key for encrypting API keys at rest.
     */
    private String aesKey;
}
