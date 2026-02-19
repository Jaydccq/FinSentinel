package com.example.finsentinel.config;

import com.example.finsentinel.service.storage.GoogleDriveStorageService;
import com.example.finsentinel.service.storage.RustfsStorageService;
import com.example.finsentinel.service.storage.StorageService;
import com.google.api.client.googleapis.javanet.GoogleNetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.drive.Drive;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.AccessToken;
import com.google.auth.oauth2.UserCredentials;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;
import java.security.GeneralSecurityException;

@Slf4j
@Configuration
public class StorageConfig {

    @Bean
    public StorageService storageService(
            StorageProperties storageProperties,
            GoogleDriveProperties googleDriveProperties) {

        String provider = storageProperties.getProvider();
        log.info("Initializing storage provider: {}", provider);

        return switch (provider) {
            case "rustfs" -> new RustfsStorageService(storageProperties);
            case "google-drive" -> createGoogleDriveService(googleDriveProperties);
            default -> throw new IllegalArgumentException(
                    "Unknown storage provider: " + provider + ". Supported: rustfs, google-drive");
        };
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
