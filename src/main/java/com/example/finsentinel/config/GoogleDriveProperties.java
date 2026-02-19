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
    /** Path to the service account JSON key file. */
    private String credentialsPath;
    /** Application name sent in API requests. */
    private String applicationName = "FinSentinel";
    /** The root folder ID in the Shared Drive where all documents are stored. */
    private String rootFolderId;
}
