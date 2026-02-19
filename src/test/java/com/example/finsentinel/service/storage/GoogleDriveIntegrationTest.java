package com.example.finsentinel.service.storage;

import com.example.finsentinel.config.GoogleDriveProperties;
import com.google.api.client.googleapis.javanet.GoogleNetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.drive.Drive;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.UserCredentials;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Live integration test for Google Drive storage.
 * Requires GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET,
 * GOOGLE_DRIVE_REFRESH_TOKEN, and GOOGLE_DRIVE_ROOT_FOLDER_ID in environment.
 * Run manually: ./gradlew test --tests "*.GoogleDriveIntegrationTest"
 */
@Tag("integration")
class GoogleDriveIntegrationTest {

    @Test
    void uploadAndDownloadRoundTrip() throws Exception {
        String clientId = System.getenv("GOOGLE_DRIVE_CLIENT_ID");
        String clientSecret = System.getenv("GOOGLE_DRIVE_CLIENT_SECRET");
        String refreshToken = System.getenv("GOOGLE_DRIVE_REFRESH_TOKEN");
        String rootFolderId = System.getenv("GOOGLE_DRIVE_ROOT_FOLDER_ID");

        if (clientId == null || clientId.isBlank()
                || clientSecret == null || clientSecret.isBlank()
                || refreshToken == null || refreshToken.isBlank()
                || rootFolderId == null || rootFolderId.isBlank()) {
            System.out.println("SKIPPED: Google Drive OAuth env vars not set");
            return;
        }

        // Build Drive client with OAuth2 user credentials
        UserCredentials credentials = UserCredentials.newBuilder()
                .setClientId(clientId)
                .setClientSecret(clientSecret)
                .setRefreshToken(refreshToken)
                .build();

        Drive drive = new Drive.Builder(
                GoogleNetHttpTransport.newTrustedTransport(),
                GsonFactory.getDefaultInstance(),
                new HttpCredentialsAdapter(credentials))
                .setApplicationName("FinSentinel-Test")
                .build();

        GoogleDriveProperties props = new GoogleDriveProperties();
        props.setRootFolderId(rootFolderId);

        GoogleDriveStorageService service = new GoogleDriveStorageService(drive, props);

        // Upload
        String testKey = "test/integration-test.txt";
        byte[] testContent = "Hello from FinSentinel integration test!".getBytes(StandardCharsets.UTF_8);
        service.upload(testKey, testContent, "text/plain");
        System.out.println("Upload successful: " + testKey);

        // Download
        byte[] downloaded = service.download(testKey);
        String downloadedText = new String(downloaded, StandardCharsets.UTF_8);
        System.out.println("Download successful: " + downloadedText);

        assertThat(downloadedText).isEqualTo("Hello from FinSentinel integration test!");
        System.out.println("Round-trip test PASSED!");
    }
}
