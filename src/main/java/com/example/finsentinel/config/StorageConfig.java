package com.example.finsentinel.config;

import com.example.finsentinel.service.storage.GoogleDriveStorageService;
import com.example.finsentinel.service.storage.HybridStorageService;
import com.example.finsentinel.service.storage.RustfsStorageService;
import com.example.finsentinel.service.storage.StorageService;
import com.google.api.client.googleapis.javanet.GoogleNetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.drive.Drive;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.UserCredentials;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import java.io.IOException;
import java.security.GeneralSecurityException;

@Slf4j
@Configuration
public class StorageConfig {

    // --- Single-provider modes (backward compatible) ---

    @Bean
    @Primary
    @ConditionalOnExpression("'${app.storage.provider}' == 'rustfs'")
    public StorageService rustfsOnlyStorageService(StorageProperties storageProperties) {
        log.info("Initializing storage provider: rustfs (single mode)");
        return new RustfsStorageService(storageProperties);
    }

    @Bean
    @Primary
    @ConditionalOnExpression("'${app.storage.provider}' == 'google-drive'")
    public StorageService googleDriveOnlyStorageService(GoogleDriveProperties googleDriveProperties) {
        log.info("Initializing storage provider: google-drive (single mode)");
        return createGoogleDriveService(googleDriveProperties);
    }

    // --- Hybrid mode: named beans for both backends + HybridStorageService as @Primary ---

    @Bean("rustfsStorage")
    @ConditionalOnExpression("'${app.storage.provider}' == 'hybrid'")
    public StorageService rustfsStorage(StorageProperties storageProperties) {
        log.info("Initializing RustFS storage (hybrid hot tier)");
        return new RustfsStorageService(storageProperties);
    }

    @Bean("googleDriveStorage")
    @ConditionalOnExpression("'${app.storage.provider}' == 'hybrid'")
    public StorageService googleDriveStorage(GoogleDriveProperties googleDriveProperties) {
        log.info("Initializing Google Drive storage (hybrid cold tier)");
        return createGoogleDriveService(googleDriveProperties);
    }

    @Bean
    @Primary
    @ConditionalOnExpression("'${app.storage.provider}' == 'hybrid'")
    public StorageService hybridStorageService(
            @org.springframework.beans.factory.annotation.Qualifier("rustfsStorage") StorageService rustfsStorage,
            @org.springframework.beans.factory.annotation.Qualifier("googleDriveStorage") StorageService googleDriveStorage) {
        log.info("Initializing storage provider: hybrid (RustFS hot + Google Drive cold)");
        return new HybridStorageService(rustfsStorage, googleDriveStorage);
    }

    private GoogleDriveStorageService createGoogleDriveService(GoogleDriveProperties props) {
        try {
            UserCredentials credentials = UserCredentials.newBuilder()
                    .setClientId(props.getClientId())
                    .setClientSecret(props.getClientSecret())
                    .setRefreshToken(props.getRefreshToken())
                    .build();

            // Force token refresh to validate credentials at startup
            credentials.refreshIfExpired();

            Drive drive = new Drive.Builder(
                    GoogleNetHttpTransport.newTrustedTransport(),
                    GsonFactory.getDefaultInstance(),
                    new HttpCredentialsAdapter(credentials))
                    .setApplicationName(props.getApplicationName())
                    .build();

            log.info("Google Drive client initialized with OAuth2 user credentials");
            return new GoogleDriveStorageService(drive, props);
        } catch (IOException | GeneralSecurityException e) {
            throw new RuntimeException("Failed to initialize Google Drive client", e);
        }
    }
}
