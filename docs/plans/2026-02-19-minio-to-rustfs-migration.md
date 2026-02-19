# MinIO to RustFS Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace MinIO with RustFS as the S3-compatible object storage backend, gaining 2.3x performance for small objects and Apache 2.0 licensing.

**Architecture:** RustFS is a drop-in replacement for MinIO — same S3 API, same ports (9000/9001), same AWS SDK client. The existing `MinioStorageService` already uses `software.amazon.awssdk:s3` (not the MinIO-specific SDK), so **zero Java code changes** are needed for S3 operations. The migration is: (1) swap Docker image, (2) update env vars, (3) rename service class + references for clarity, (4) update tests and docs.

**Tech Stack:** RustFS (`rustfs/rustfs:latest`), AWS SDK for Java v2 (`software.amazon.awssdk:s3:2.31.1` — unchanged), Docker Compose

---

## Key Discovery: Zero SDK Changes Required

The current `MinioStorageService` uses `software.amazon.awssdk:s3` with:
- `S3Client.builder().endpointOverride().forcePathStyle(true)` — **identical** to RustFS Java example
- `PutObjectRequest`, `GetObjectRequest`, `HeadBucketRequest`, `CreateBucketRequest` — all supported by RustFS
- Same port 9000, same credential pattern

RustFS env vars: `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`, `RUSTFS_CONSOLE_ENABLE`

---

### Task 1: Update Docker Compose — Swap MinIO Image for RustFS

**Files:**
- Modify: `docker-compose.yml:28-44` (minio service block)

**Step 1: Replace the `minio` service with `rustfs`**

Change the service definition from:
```yaml
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: rustfsadmin
      MINIO_ROOT_PASSWORD: rustfsadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 5
```

To:
```yaml
  rustfs:
    image: rustfs/rustfs:latest
    environment:
      RUSTFS_ACCESS_KEY: rustfsadmin
      RUSTFS_SECRET_KEY: rustfsadmin
      RUSTFS_CONSOLE_ENABLE: "true"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - rustfsdata:/data
    command: ["--address", ":9000", "--console-address", ":9001", "--access-key", "rustfsadmin", "--secret-key", "rustfsadmin", "/data"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 3s
      retries: 5
```

**Step 2: Update backend depends_on reference**

Change `minio` → `rustfs` in backend service:
```yaml
    depends_on:
      ...
      rustfs:
        condition: service_healthy
```

**Step 3: Update backend environment — storage endpoint hostname**

Change:
```yaml
      APP_STORAGE_ENDPOINT: http://minio:9000
```
To:
```yaml
      APP_STORAGE_ENDPOINT: http://rustfs:9000
```

**Step 4: Rename volume**

Change `miniodata` → `rustfsdata` in the `volumes:` section at the bottom.

**Step 5: Verify compose config is valid**

Run: `docker compose config --quiet`
Expected: No output (means valid)

**Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "infra: replace MinIO with RustFS in docker-compose"
```

---

### Task 2: Rename MinioStorageService → RustfsStorageService

**Files:**
- Rename: `src/main/java/com/example/finsentinel/service/storage/MinioStorageService.java` → `RustfsStorageService.java`
- Modify: `src/main/java/com/example/finsentinel/config/StorageConfig.java:32`

**Step 1: Rename the class file**

Rename `MinioStorageService.java` to `RustfsStorageService.java`. Update the class name, constructor name, and log messages:

```java
@Slf4j
public class RustfsStorageService implements StorageService {

    private final S3Client s3Client;
    private final StorageProperties storageProperties;

    public RustfsStorageService(StorageProperties storageProperties) {
        this.storageProperties = storageProperties;
        this.s3Client = S3Client.builder()
                .endpointOverride(URI.create(storageProperties.getEndpoint()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(
                                storageProperties.getAccessKey(),
                                storageProperties.getSecretKey())))
                .region(Region.of(storageProperties.getRegion()))
                .forcePathStyle(true)
                .build();
        ensureBucketExists();
    }

    @Override
    public void upload(String key, byte[] content, String contentType) {
        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(storageProperties.getBucket())
                .key(key)
                .contentType(contentType)
                .build();
        s3Client.putObject(request, RequestBody.fromBytes(content));
        log.info("Uploaded {} ({} bytes) to RustFS", key, content.length);
    }

    @Override
    public byte[] download(String key) {
        GetObjectRequest request = GetObjectRequest.builder()
                .bucket(storageProperties.getBucket())
                .key(key)
                .build();
        try (var response = s3Client.getObject(request)) {
            return response.readAllBytes();
        } catch (IOException e) {
            throw new RuntimeException("Failed to download " + key, e);
        }
    }

    private void ensureBucketExists() {
        try {
            s3Client.headBucket(HeadBucketRequest.builder()
                    .bucket(storageProperties.getBucket())
                    .build());
        } catch (NoSuchBucketException e) {
            s3Client.createBucket(CreateBucketRequest.builder()
                    .bucket(storageProperties.getBucket())
                    .build());
            log.info("Created RustFS bucket: {}", storageProperties.getBucket());
        }
    }
}
```

**Step 2: Update StorageConfig to reference RustfsStorageService**

In `StorageConfig.java`, change:
```java
case "minio" -> new MinioStorageService(storageProperties);
```
To:
```java
case "rustfs" -> new RustfsStorageService(storageProperties);
```

Also update the import and the error message:
```java
import com.example.finsentinel.service.storage.RustfsStorageService;
// ...
default -> throw new IllegalArgumentException(
    "Unknown storage provider: " + provider + ". Supported: rustfs, google-drive");
```

**Step 3: Delete old MinioStorageService.java**

Remove `src/main/java/com/example/finsentinel/service/storage/MinioStorageService.java`.

**Step 4: Compile to verify**

Run: `./gradlew compileJava`
Expected: BUILD SUCCESSFUL

**Step 5: Commit**

```bash
git add -A src/main/java/com/example/finsentinel/service/storage/ src/main/java/com/example/finsentinel/config/StorageConfig.java
git commit -m "refactor: rename MinioStorageService to RustfsStorageService"
```

---

### Task 3: Update Configuration Defaults

**Files:**
- Modify: `src/main/resources/application.yaml:51-57`
- Modify: `src/main/java/com/example/finsentinel/config/StorageProperties.java:19`

**Step 1: Update default provider in StorageProperties**

Change:
```java
private String provider = "minio";
```
To:
```java
private String provider = "rustfs";
```

**Step 2: Update application.yaml default provider**

Change:
```yaml
    provider: ${APP_STORAGE_PROVIDER:minio}
```
To:
```yaml
    provider: ${APP_STORAGE_PROVIDER:rustfs}
```

**Step 3: Compile**

Run: `./gradlew compileJava`
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add src/main/resources/application.yaml src/main/java/com/example/finsentinel/config/StorageProperties.java
git commit -m "config: change default storage provider from minio to rustfs"
```

---

### Task 4: Update Tests

**Files:**
- Rename: `src/test/java/com/example/finsentinel/service/storage/MinioStorageServiceTest.java` → `RustfsStorageServiceTest.java`
- Modify: `src/test/java/com/example/finsentinel/config/StorageConfigTest.java`

**Step 1: Rename and update MinioStorageServiceTest**

Rename to `RustfsStorageServiceTest.java`:
```java
package com.example.finsentinel.service.storage;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class RustfsStorageServiceTest {

    @Test
    void rustfsStorageServiceImplementsStorageService() {
        assertThat(StorageService.class).isInterface();
        assertThat(StorageService.class.isAssignableFrom(RustfsStorageService.class)).isTrue();
    }
}
```

**Step 2: Update StorageConfigTest**

Change default provider assertion:
```java
@Test
void rustfsProviderIsDefault() {
    StorageProperties props = new StorageProperties();
    assertThat(props.getProvider()).isEqualTo("rustfs");
}
```

Update the error message assertion if needed (the "unknown" string still works since the test uses "unknown" as provider).

**Step 3: Delete old MinioStorageServiceTest.java**

Remove `src/test/java/com/example/finsentinel/service/storage/MinioStorageServiceTest.java`.

**Step 4: Run tests**

Run: `./gradlew test --tests "com.example.finsentinel.service.storage.RustfsStorageServiceTest" --tests "com.example.finsentinel.config.StorageConfigTest"`
Expected: All tests pass

**Step 5: Commit**

```bash
git add -A src/test/
git commit -m "test: update storage tests for RustFS rename"
```

---

### Task 5: Fix Abstraction Leaks in Tests That Mock Concrete MinioStorageService

**Files:**
- Modify: `src/test/java/com/example/finsentinel/service/document/DocumentUploadServiceTest.java:8,40`
- Modify: `src/test/java/com/example/finsentinel/service/scraper/SecEdgarScraperTest.java:5,33`

Both tests `@Mock` the concrete `MinioStorageService` instead of the `StorageService` interface. After the rename, these will fail to compile. Fix the abstraction leak.

**Step 1: Fix DocumentUploadServiceTest**

Change import:
```java
import com.example.finsentinel.service.storage.MinioStorageService;
```
To:
```java
import com.example.finsentinel.service.storage.StorageService;
```

Change mock field:
```java
@Mock
private MinioStorageService minioStorageService;
```
To:
```java
@Mock
private StorageService storageService;
```

Note: The `@InjectMocks` on `DocumentUploadService` will auto-inject the `storageService` mock since the production class has a `StorageService storageService` field. The field name matches.

**Step 2: Fix SecEdgarScraperTest**

Change import:
```java
import com.example.finsentinel.service.storage.MinioStorageService;
```
To:
```java
import com.example.finsentinel.service.storage.StorageService;
```

Change mock field:
```java
@Mock private MinioStorageService storageService;
```
To:
```java
@Mock private StorageService storageService;
```

Note: `SecEdgarScraperTest` uses manual constructor injection in `setUp()`, passing `storageService` directly. Since the constructor takes `StorageService`, this will work.

**Step 3: Compile to verify**

Run: `./gradlew compileTestJava`
Expected: BUILD SUCCESSFUL

**Step 4: Run affected tests**

Run: `./gradlew test --tests "com.example.finsentinel.service.document.DocumentUploadServiceTest" --tests "com.example.finsentinel.service.scraper.SecEdgarScraperTest"`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/test/java/com/example/finsentinel/service/document/DocumentUploadServiceTest.java src/test/java/com/example/finsentinel/service/scraper/SecEdgarScraperTest.java
git commit -m "fix: mock StorageService interface instead of concrete MinioStorageService in tests"
```

---

### Task 6: Update build.gradle Comment and CLAUDE.md Documentation

**Files:**
- Modify: `build.gradle:60-61`
- Modify: `CLAUDE.md`

**Step 1: Update build.gradle comment**

Change:
```groovy
    // AWS S3 SDK for MinIO
```
To:
```groovy
    // AWS S3 SDK for RustFS (S3-compatible object storage)
```

Note: The actual dependency `software.amazon.awssdk:s3:2.31.1` stays the same — RustFS uses standard S3 API.

**Step 2: Update CLAUDE.md references**

Replace all mentions of "MinIO" / "minio" / "MinioStorageService" with "RustFS" / "rustfs" / "RustfsStorageService" in the project CLAUDE.md. Key sections:
- Architecture section: `service/storage/` description
- RAG Ingestion Pipeline: "MinIO" → "RustFS"
- Infrastructure section: "S3/MinIO" → "S3/RustFS"
- Docker section: service hostname "minio" → "rustfs"
- Conventions: scraper contract mention of MinIO

**Step 3: Compile + run all unit tests**

Run: `./gradlew test --tests "com.example.finsentinel.util.*" --tests "com.example.finsentinel.service.*" --tests "com.example.finsentinel.agent.*" --tests "com.example.finsentinel.controller.*"`
Expected: All tests pass

**Step 4: Commit**

```bash
git add build.gradle CLAUDE.md
git commit -m "docs: update references from MinIO to RustFS"
```

---

### Task 7: Update .env File (if exists) and Verify Docker Startup

**Files:**
- Modify: `.env` (if it references MinIO)
- Verify: `docker compose up -d` works

**Step 1: Check and update .env**

If `.env` contains `APP_STORAGE_PROVIDER=minio`, change to `APP_STORAGE_PROVIDER=rustfs`.

**Step 2: Bring up Docker stack**

Run: `docker compose up -d`
Expected: All services start, including `rustfs` container

**Step 3: Verify RustFS is healthy**

Run: `curl -s http://localhost:9000/minio/health/live`
Expected: HTTP 200 (RustFS supports MinIO health endpoint for compatibility)

**Step 4: Verify console access**

Open `http://localhost:9001` — RustFS console should load (similar to MinIO console).

---

## Migration Summary

| Aspect | Before (MinIO) | After (RustFS) | Changes |
|--------|----------------|-----------------|---------|
| Docker image | `minio/minio:latest` | `rustfs/rustfs:latest` | Image swap |
| S3 SDK | `software.amazon.awssdk:s3:2.31.1` | Same | None |
| API Port | 9000 | 9000 | None |
| Console Port | 9001 | 9001 | None |
| Service class | `MinioStorageService` | `RustfsStorageService` | Rename only |
| Java S3 code | `S3Client` + `forcePathStyle(true)` | Same | None |
| Provider config | `minio` | `rustfs` | String change |
| License | AGPL v3 | Apache 2.0 | Improvement |
| Performance | Baseline | 2.3x for small objects | Improvement |

**Total Java logic changes: 0** — The entire migration is renaming + Docker image swap because both MinIO and RustFS use the standard S3 API, and our code already uses the AWS S3 SDK (not MinIO-specific SDK).
