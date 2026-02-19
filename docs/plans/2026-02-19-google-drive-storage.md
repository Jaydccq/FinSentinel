# Google Drive Storage for RAG PDFs — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace MinIO with Google Drive as the backend storage for RAG PDF files, using a `StorageService` interface so both backends remain swappable.

**Architecture:** Extract a `StorageService` interface from `MinioStorageService`, then implement `GoogleDriveStorageService` behind the same contract. A `@ConfigurationProperties`-driven profile (`app.storage.provider=google-drive` vs `minio`) selects which implementation is active. All 5 callers already depend on a concrete class — the interface extraction is the main refactor.

**Tech Stack:** Google Drive API v3 (`google-api-services-drive:v3-rev20251210-2.0.0`), Service Account auth (`google-auth-library-oauth2-http:1.42.1`), Spring Boot 4.0 `@ConfigurationProperties`, Java 21.

---

## Pre-requisites (manual, not automated)

Before coding, the user must:
1. Create a Google Cloud project (or use existing one)
2. Enable the Google Drive API
3. Create a Service Account, download the JSON key file
4. Create a **Shared Drive** (Service Accounts cannot access personal "My Drive" since April 2025)
5. Share the Shared Drive with the service account email (Editor role)
6. Note down the Shared Drive ID (visible in the URL when browsing it)
7. Place the JSON key file somewhere secure (e.g. `~/.config/finsentinel/google-service-account.json`) — **never commit it to git**

---

### Task 1: Extract `StorageService` interface

**Files:**
- Create: `src/main/java/com/example/finsentinel/service/storage/StorageService.java`
- Modify: `src/main/java/com/example/finsentinel/service/storage/MinioStorageService.java`
- Test: `src/test/java/com/example/finsentinel/service/storage/MinioStorageServiceTest.java`

**Step 1: Write the failing test**

```java
package com.example.finsentinel.service.storage;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class MinioStorageServiceTest {

    @Test
    void minioStorageServiceImplementsStorageService() {
        assertThat(StorageService.class).isInterface();
        assertThat(StorageService.class.isAssignableFrom(MinioStorageService.class)).isTrue();
    }
}
```

**Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "com.example.finsentinel.service.storage.MinioStorageServiceTest" -x compileTestJava`
Expected: Compile error — `StorageService` does not exist.

**Step 3: Create the interface and make MinioStorageService implement it**

`StorageService.java`:
```java
package com.example.finsentinel.service.storage;

/**
 * Abstraction for document storage backends (MinIO, Google Drive, etc.).
 */
public interface StorageService {

    /**
     * Uploads a file to storage.
     *
     * @param key         the storage key / object path
     * @param content     the file bytes
     * @param contentType the MIME content type
     */
    void upload(String key, byte[] content, String contentType);

    /**
     * Downloads a file from storage.
     *
     * @param key the storage key / object path
     * @return the file bytes
     */
    byte[] download(String key);
}
```

In `MinioStorageService.java`, add `implements StorageService`:
```java
public class MinioStorageService implements StorageService {
```

**Step 4: Run test to verify it passes**

Run: `./gradlew test --tests "com.example.finsentinel.service.storage.MinioStorageServiceTest"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/java/com/example/finsentinel/service/storage/StorageService.java \
        src/main/java/com/example/finsentinel/service/storage/MinioStorageService.java \
        src/test/java/com/example/finsentinel/service/storage/MinioStorageServiceTest.java
git commit -m "refactor: extract StorageService interface from MinioStorageService"
```

---

### Task 2: Migrate all callers from concrete `MinioStorageService` to `StorageService` interface

**Files:**
- Modify: `src/main/java/com/example/finsentinel/service/scraper/SecEdgarScraper.java`
- Modify: `src/main/java/com/example/finsentinel/service/scraper/PolygonNewsScraper.java`
- Modify: `src/main/java/com/example/finsentinel/service/scraper/InvestopediaScraper.java`
- Modify: `src/main/java/com/example/finsentinel/service/document/DocumentUploadService.java`
- Modify: `src/main/java/com/example/finsentinel/stream/VectorizeStreamConsumer.java`

**Step 1: In each of the 5 files, change the field type and import**

For every file, replace:
```java
import com.example.finsentinel.service.storage.MinioStorageService;
// ...
private final MinioStorageService storageService;       // (or minioStorageService)
```

With:
```java
import com.example.finsentinel.service.storage.StorageService;
// ...
private final StorageService storageService;
```

Specific field names per file:
- `SecEdgarScraper`: field `storageService` (line 37)
- `PolygonNewsScraper`: field `storageService` (line 34)
- `InvestopediaScraper`: field `storageService` (line 34)
- `DocumentUploadService`: field `minioStorageService` → rename to `storageService` (line 33), and update the call at line 77 from `minioStorageService.upload(...)` to `storageService.upload(...)`
- `VectorizeStreamConsumer`: field `minioStorageService` → rename to `storageService` (line 36), and update the call at line 121 from `minioStorageService.download(...)` to `storageService.download(...)`

**Step 2: Run all existing unit tests**

Run: `./gradlew test --tests "com.example.finsentinel.util.*" --tests "com.example.finsentinel.service.*" --tests "com.example.finsentinel.agent.*" --tests "com.example.finsentinel.controller.*"`
Expected: All PASS (since only one `StorageService` bean exists, Spring injects it automatically)

**Step 3: Commit**

```bash
git add src/main/java/com/example/finsentinel/service/scraper/SecEdgarScraper.java \
        src/main/java/com/example/finsentinel/service/scraper/PolygonNewsScraper.java \
        src/main/java/com/example/finsentinel/service/scraper/InvestopediaScraper.java \
        src/main/java/com/example/finsentinel/service/document/DocumentUploadService.java \
        src/main/java/com/example/finsentinel/stream/VectorizeStreamConsumer.java
git commit -m "refactor: migrate all callers from MinioStorageService to StorageService interface"
```

---

### Task 3: Add Google Drive dependencies and configuration properties

**Files:**
- Modify: `build.gradle`
- Create: `src/main/java/com/example/finsentinel/config/GoogleDriveProperties.java`
- Modify: `src/main/resources/application.yaml`

**Step 1: Add dependencies to `build.gradle`**

After the existing `software.amazon.awssdk:s3:2.31.1` line, add:
```gradle
// Google Drive API
implementation 'com.google.apis:google-api-services-drive:v3-rev20251210-2.0.0'
implementation 'com.google.auth:google-auth-library-oauth2-http:1.42.1'
```

**Step 2: Create `GoogleDriveProperties.java`**

```java
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
```

**Step 3: Add `provider` field to `StorageProperties` and Google Drive config to `application.yaml`**

In `StorageProperties.java`, add:
```java
/** Storage backend: "minio" or "google-drive". */
private String provider = "minio";
```

In `application.yaml`, under the existing `app:` block, add:
```yaml
  storage:
    provider: ${APP_STORAGE_PROVIDER:minio}
    # ... existing minio fields ...
  google-drive:
    credentials-path: ${GOOGLE_DRIVE_CREDENTIALS_PATH:}
    application-name: FinSentinel
    root-folder-id: ${GOOGLE_DRIVE_ROOT_FOLDER_ID:}
```

**Step 4: Verify compilation**

Run: `./gradlew compileJava`
Expected: BUILD SUCCESSFUL

**Step 5: Commit**

```bash
git add build.gradle \
        src/main/java/com/example/finsentinel/config/GoogleDriveProperties.java \
        src/main/java/com/example/finsentinel/config/StorageProperties.java \
        src/main/resources/application.yaml
git commit -m "feat: add Google Drive API dependencies and configuration properties"
```

---

### Task 4: Implement `GoogleDriveStorageService`

**Files:**
- Create: `src/main/java/com/example/finsentinel/service/storage/GoogleDriveStorageService.java`
- Test: `src/test/java/com/example/finsentinel/service/storage/GoogleDriveStorageServiceTest.java`

**Step 1: Write the failing test**

```java
package com.example.finsentinel.service.storage;

import com.example.finsentinel.config.GoogleDriveProperties;
import com.google.api.services.drive.Drive;
import com.google.api.services.drive.Drive.Files;
import com.google.api.services.drive.Drive.Files.Create;
import com.google.api.services.drive.Drive.Files.Get;
import com.google.api.services.drive.model.File;
import com.google.api.services.drive.model.FileList;
import com.google.api.client.http.InputStreamContent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class GoogleDriveStorageServiceTest {

    @Mock private Drive drive;
    @Mock private Files files;
    @Mock private Create createRequest;
    @Mock private Get getRequest;
    @Mock private Drive.Files.List listRequest;

    private GoogleDriveProperties properties;
    private GoogleDriveStorageService service;

    @BeforeEach
    void setUp() {
        properties = new GoogleDriveProperties();
        properties.setRootFolderId("root-folder-id");
        properties.setApplicationName("FinSentinel-Test");

        when(drive.files()).thenReturn(files);
        service = new GoogleDriveStorageService(drive, properties);
    }

    @Test
    void implementsStorageServiceInterface() {
        assertThat(service).isInstanceOf(StorageService.class);
    }

    @Test
    void uploadCreatesFileInCorrectFolder() throws Exception {
        // Given
        byte[] content = "test content".getBytes();
        String key = "sec-filings/AAPL/doc123.pdf";
        File createdFile = new File();
        createdFile.setId("drive-file-id-123");

        when(files.list()).thenReturn(listRequest);
        when(listRequest.setQ(anyString())).thenReturn(listRequest);
        when(listRequest.setSpaces(anyString())).thenReturn(listRequest);
        when(listRequest.setFields(anyString())).thenReturn(listRequest);
        when(listRequest.setPageSize(anyInt())).thenReturn(listRequest);

        // Simulate folder lookup returning empty (folder doesn't exist) then creating
        FileList emptyList = new FileList();
        emptyList.setFiles(Collections.emptyList());
        when(listRequest.execute()).thenReturn(emptyList);

        // For folder creation
        Drive.Files.Create folderCreate = mock(Drive.Files.Create.class);
        when(files.create(any(File.class))).thenReturn(folderCreate);
        when(folderCreate.setFields(anyString())).thenReturn(folderCreate);
        File createdFolder = new File();
        createdFolder.setId("created-folder-id");
        when(folderCreate.execute()).thenReturn(createdFolder);

        // For file upload
        when(files.create(any(File.class), any(InputStreamContent.class))).thenReturn(createRequest);
        when(createRequest.setFields(anyString())).thenReturn(createRequest);
        when(createRequest.execute()).thenReturn(createdFile);

        // When
        service.upload(key, content, "application/pdf");

        // Then
        verify(files).create(any(File.class), any(InputStreamContent.class));
    }

    @Test
    void downloadReturnsFileBytes() throws Exception {
        // Given
        String key = "sec-filings/AAPL/doc123.pdf";
        byte[] expectedBytes = "downloaded content".getBytes();

        // Mock file lookup by name
        when(files.list()).thenReturn(listRequest);
        when(listRequest.setQ(anyString())).thenReturn(listRequest);
        when(listRequest.setSpaces(anyString())).thenReturn(listRequest);
        when(listRequest.setFields(anyString())).thenReturn(listRequest);
        when(listRequest.setPageSize(anyInt())).thenReturn(listRequest);
        File foundFile = new File();
        foundFile.setId("drive-file-id-123");
        foundFile.setName("doc123.pdf");
        FileList fileList = new FileList();
        fileList.setFiles(List.of(foundFile));
        when(listRequest.execute()).thenReturn(fileList);

        // Mock download
        when(files.get("drive-file-id-123")).thenReturn(getRequest);
        doAnswer(invocation -> {
            ByteArrayOutputStream out = invocation.getArgument(0);
            out.write(expectedBytes);
            return null;
        }).when(getRequest).executeMediaAndDownloadTo(any(java.io.OutputStream.class));

        // When
        byte[] result = service.download(key);

        // Then
        assertThat(result).isEqualTo(expectedBytes);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "com.example.finsentinel.service.storage.GoogleDriveStorageServiceTest"`
Expected: FAIL — `GoogleDriveStorageService` does not exist.

**Step 3: Implement `GoogleDriveStorageService`**

```java
package com.example.finsentinel.service.storage;

import com.example.finsentinel.config.GoogleDriveProperties;
import com.google.api.client.http.InputStreamContent;
import com.google.api.services.drive.Drive;
import com.google.api.services.drive.model.File;
import com.google.api.services.drive.model.FileList;
import lombok.extern.slf4j.Slf4j;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.List;

/**
 * Google Drive implementation of {@link StorageService}.
 * Uses folder-based hierarchy mirroring the object key path structure.
 * Folders are created on-demand and cached by path.
 */
@Slf4j
public class GoogleDriveStorageService implements StorageService {

    private static final String FOLDER_MIME = "application/vnd.google-apps.folder";

    private final Drive drive;
    private final GoogleDriveProperties properties;

    public GoogleDriveStorageService(Drive drive, GoogleDriveProperties properties) {
        this.drive = drive;
        this.properties = properties;
    }

    @Override
    public void upload(String key, byte[] content, String contentType) {
        try {
            String[] parts = key.split("/");
            String fileName = parts[parts.length - 1];

            // Navigate/create folder hierarchy for path segments before the filename
            String parentFolderId = properties.getRootFolderId();
            for (int i = 0; i < parts.length - 1; i++) {
                parentFolderId = getOrCreateFolder(parts[i], parentFolderId);
            }

            // Upload the file
            File fileMetadata = new File();
            fileMetadata.setName(fileName);
            fileMetadata.setParents(Collections.singletonList(parentFolderId));

            InputStreamContent mediaContent = new InputStreamContent(
                    contentType, new ByteArrayInputStream(content));
            mediaContent.setLength(content.length);

            File uploaded = drive.files()
                    .create(fileMetadata, mediaContent)
                    .setFields("id, name")
                    .execute();

            log.info("Uploaded {} ({} bytes) to Google Drive, fileId={}", key, content.length, uploaded.getId());
        } catch (IOException e) {
            throw new RuntimeException("Failed to upload " + key + " to Google Drive", e);
        }
    }

    @Override
    public byte[] download(String key) {
        try {
            String[] parts = key.split("/");
            String fileName = parts[parts.length - 1];

            // Navigate folder hierarchy to find the parent folder
            String parentFolderId = properties.getRootFolderId();
            for (int i = 0; i < parts.length - 1; i++) {
                String folderId = findFolderId(parts[i], parentFolderId);
                if (folderId == null) {
                    throw new RuntimeException("Folder not found: " + parts[i] + " in path " + key);
                }
                parentFolderId = folderId;
            }

            // Find the file by name in the final folder
            String fileId = findFileId(fileName, parentFolderId);
            if (fileId == null) {
                throw new RuntimeException("File not found in Google Drive: " + key);
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            drive.files().get(fileId).executeMediaAndDownloadTo(baos);
            return baos.toByteArray();
        } catch (IOException e) {
            throw new RuntimeException("Failed to download " + key + " from Google Drive", e);
        }
    }

    private String getOrCreateFolder(String folderName, String parentId) throws IOException {
        String existing = findFolderId(folderName, parentId);
        if (existing != null) {
            return existing;
        }

        File folderMetadata = new File();
        folderMetadata.setName(folderName);
        folderMetadata.setMimeType(FOLDER_MIME);
        folderMetadata.setParents(Collections.singletonList(parentId));

        File created = drive.files()
                .create(folderMetadata)
                .setFields("id")
                .execute();

        log.info("Created Google Drive folder: {} (id={})", folderName, created.getId());
        return created.getId();
    }

    private String findFolderId(String folderName, String parentId) throws IOException {
        FileList result = drive.files().list()
                .setQ(String.format(
                        "name='%s' and mimeType='%s' and '%s' in parents and trashed=false",
                        escapeSingleQuotes(folderName), FOLDER_MIME, parentId))
                .setSpaces("drive")
                .setFields("files(id)")
                .setPageSize(1)
                .execute();

        List<File> files = result.getFiles();
        return (files != null && !files.isEmpty()) ? files.get(0).getId() : null;
    }

    private String findFileId(String fileName, String parentId) throws IOException {
        FileList result = drive.files().list()
                .setQ(String.format(
                        "name='%s' and '%s' in parents and trashed=false",
                        escapeSingleQuotes(fileName), parentId))
                .setSpaces("drive")
                .setFields("files(id)")
                .setPageSize(1)
                .execute();

        List<File> files = result.getFiles();
        return (files != null && !files.isEmpty()) ? files.get(0).getId() : null;
    }

    private static String escapeSingleQuotes(String str) {
        return str.replace("'", "\\'");
    }
}
```

**Step 4: Run test to verify it passes**

Run: `./gradlew test --tests "com.example.finsentinel.service.storage.GoogleDriveStorageServiceTest"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/java/com/example/finsentinel/service/storage/GoogleDriveStorageService.java \
        src/test/java/com/example/finsentinel/service/storage/GoogleDriveStorageServiceTest.java
git commit -m "feat: implement GoogleDriveStorageService with folder hierarchy support"
```

---

### Task 5: Create `StorageConfig` to conditionally wire the active backend

**Files:**
- Create: `src/main/java/com/example/finsentinel/config/StorageConfig.java`
- Modify: `src/main/java/com/example/finsentinel/service/storage/MinioStorageService.java` (remove `@Service`)
- Test: `src/test/java/com/example/finsentinel/config/StorageConfigTest.java`

**Step 1: Write the failing test**

```java
package com.example.finsentinel.config;

import com.example.finsentinel.service.storage.StorageService;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class StorageConfigTest {

    @Test
    void minioProviderIsDefault() {
        StorageProperties props = new StorageProperties();
        assertThat(props.getProvider()).isEqualTo("minio");
    }

    @Test
    void unknownProviderThrowsException() {
        StorageProperties storageProps = new StorageProperties();
        storageProps.setProvider("unknown");

        StorageConfig config = new StorageConfig();
        assertThatThrownBy(() -> config.storageService(storageProps, null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("unknown");
    }
}
```

**Step 2: Run test to verify it fails**

Run: `./gradlew test --tests "com.example.finsentinel.config.StorageConfigTest"`
Expected: FAIL — `StorageConfig` does not exist.

**Step 3: Implement `StorageConfig`**

```java
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
            GoogleDriveProperties googleDriveProperties,
            /* MinIO props are already inside storageProperties */
            StorageProperties minioProperties) {

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
```

**Step 4: Remove `@Service` from `MinioStorageService`**

In `MinioStorageService.java`, remove the `@Service` annotation (the bean is now created by `StorageConfig`):
```java
// Remove: @Service
@Slf4j
public class MinioStorageService implements StorageService {
```

**Step 5: Run tests**

Run: `./gradlew test --tests "com.example.finsentinel.config.StorageConfigTest"`
Expected: PASS

Run: `./gradlew test --tests "com.example.finsentinel.service.storage.*"`
Expected: PASS

**Step 6: Commit**

```bash
git add src/main/java/com/example/finsentinel/config/StorageConfig.java \
        src/main/java/com/example/finsentinel/service/storage/MinioStorageService.java \
        src/test/java/com/example/finsentinel/config/StorageConfigTest.java
git commit -m "feat: add StorageConfig with provider-based backend selection (minio/google-drive)"
```

---

### Task 6: Update Docker Compose and environment documentation

**Files:**
- Modify: `docker-compose.yml` (add Google Drive env vars as optional)
- Modify: `.env.example` or README (document the new env vars)

**Step 1: Add Google Drive environment variables to docker-compose.yml**

Under the `backend` service's `environment` section, add:
```yaml
      APP_STORAGE_PROVIDER: ${APP_STORAGE_PROVIDER:-minio}
      GOOGLE_DRIVE_CREDENTIALS_PATH: ${GOOGLE_DRIVE_CREDENTIALS_PATH:-}
      GOOGLE_DRIVE_ROOT_FOLDER_ID: ${GOOGLE_DRIVE_ROOT_FOLDER_ID:-}
```

If using google-drive provider in Docker, the credentials file must be mounted:
```yaml
    volumes:
      - ${GOOGLE_DRIVE_CREDENTIALS_PATH:-/dev/null}:/app/google-credentials.json:ro
```

And override the path inside the container:
```yaml
      GOOGLE_DRIVE_CREDENTIALS_PATH: /app/google-credentials.json
```

**Step 2: Verify compilation still works**

Run: `./gradlew compileJava`
Expected: BUILD SUCCESSFUL

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add Google Drive environment variables to docker-compose"
```

---

### Task 7: Run full test suite and verify no regressions

**Step 1: Run all unit tests**

Run: `./gradlew test --tests "com.example.finsentinel.util.*" --tests "com.example.finsentinel.service.*" --tests "com.example.finsentinel.agent.*" --tests "com.example.finsentinel.controller.*" --tests "com.example.finsentinel.config.*"`
Expected: All PASS

**Step 2: Verify clean compilation**

Run: `./gradlew compileJava compileTestJava`
Expected: BUILD SUCCESSFUL

**Step 3: Final commit if any fixups needed**

---

## Environment Variables Summary

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_STORAGE_PROVIDER` | `minio` | `minio` or `google-drive` |
| `APP_STORAGE_ENDPOINT` | `http://localhost:9000` | MinIO endpoint (only for minio provider) |
| `APP_STORAGE_ACCESS_KEY` | `rustfsadmin` | MinIO access key (only for minio provider) |
| `APP_STORAGE_SECRET_KEY` | `rustfsadmin` | MinIO secret key (only for minio provider) |
| `APP_STORAGE_BUCKET` | `finsentinel` | MinIO bucket (only for minio provider) |
| `APP_STORAGE_REGION` | `us-east-1` | MinIO region (only for minio provider) |
| `GOOGLE_DRIVE_CREDENTIALS_PATH` | _(empty)_ | Path to service account JSON key file |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | _(empty)_ | Shared Drive root folder ID |

## Switching from MinIO to Google Drive

```bash
# In your .env file:
APP_STORAGE_PROVIDER=google-drive
GOOGLE_DRIVE_CREDENTIALS_PATH=/path/to/service-account-key.json
GOOGLE_DRIVE_ROOT_FOLDER_ID=your-shared-drive-folder-id
```

No code changes needed — restart the application and all scrapers + upload service + vectorize consumer will use Google Drive.
