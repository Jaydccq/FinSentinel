package com.example.finsentinel.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "app.google-drive")
@Getter
@Setter
public class GoogleDriveProperties {
    /** OAuth 2.0 Client ID. */
    private String clientId;
    /** OAuth 2.0 Client Secret. */
    private String clientSecret;
    /** OAuth 2.0 Refresh Token (obtained via one-time authorization flow). */
    private String refreshToken;
    /** Application name sent in API requests. */
    private String applicationName = "FinSentinel";
    /** The root folder ID where all documents are stored. */
    private String rootFolderId;
}
