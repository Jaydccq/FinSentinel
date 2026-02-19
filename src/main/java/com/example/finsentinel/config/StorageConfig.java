package com.example.finsentinel.config;

import com.example.finsentinel.service.storage.GoogleDriveStorageService;
import com.example.finsentinel.service.storage.MinioStorageService;
import com.example.finsentinel.service.storage.StorageService;
import com.google.api.client.googleapis.javanet.GoogleNetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.drive.Drive;
import com.google.api.services.drive.DriveScopes;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.GoogleCredentials;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.FileInputStream;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.Collections;

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
            case "minio" -> new MinioStorageService(storageProperties);
            case "google-drive" -> createGoogleDriveService(googleDriveProperties);
            default -> throw new IllegalArgumentException(
                    "Unknown storage provider: " + provider + ". Supported: minio, google-drive");
        };
    }

    private GoogleDriveStorageService createGoogleDriveService(GoogleDriveProperties props) {
        try {
            GoogleCredentials credentials = GoogleCredentials.fromStream(
                    new FileInputStream(props.getCredentialsPath())
            ).createScoped(Collections.singleton(DriveScopes.DRIVE));

            Drive drive = new Drive.Builder(
                    GoogleNetHttpTransport.newTrustedTransport(),
                    GsonFactory.getDefaultInstance(),
                    new HttpCredentialsAdapter(credentials))
                    .setApplicationName(props.getApplicationName())
                    .build();

            return new GoogleDriveStorageService(drive, props);
        } catch (IOException | GeneralSecurityException e) {
            throw new RuntimeException("Failed to initialize Google Drive client", e);
        }
    }
}
