package com.example.finsentinel.service.storage;

import com.example.finsentinel.config.StorageProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

import java.io.IOException;
import java.net.URI;

/**
 * Implements minio storage service business operations and integrations.
 *
 * <p>This class is part of the service layer in FinSentinel.
 */

@Service
@Slf4j
public class MinioStorageService implements StorageService {

    private final S3Client s3Client;
    private final StorageProperties storageProperties;

    /**
     * Creates a new MinioStorageService instance.
     *
     * <p>This method is defined in {@link MinioStorageService}.
     * @param storageProperties storage properties (StorageProperties)
     */

    public MinioStorageService(StorageProperties storageProperties) {
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

    /**
     * Executes upload.
     *
     * <p>This method belongs to {@link MinioStorageService} and encapsulates the
     * upload workflow.
     * @param key key (String)
     * @param content content (byte[])
     * @param contentType content type (String)
     */

    @Override
    public void upload(String key, byte[] content, String contentType) {
        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(storageProperties.getBucket())
                .key(key)
                .contentType(contentType)
                .build();
        s3Client.putObject(request, RequestBody.fromBytes(content));
        log.info("Uploaded {} ({} bytes) to MinIO", key, content.length);
    }

    /**
     * Executes download.
     *
     * <p>This method belongs to {@link MinioStorageService} and encapsulates the
     * download workflow.
     * @param key key (String)
     * @return the download result (byte[])
     */

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

    /**
     * Executes ensure bucket exists.
     *
     * <p>This method belongs to {@link MinioStorageService} and encapsulates the
     * ensure bucket exists workflow.
     */

    private void ensureBucketExists() {
        try {
            s3Client.headBucket(HeadBucketRequest.builder()
                    .bucket(storageProperties.getBucket())
                    .build());
        } catch (NoSuchBucketException e) {
            s3Client.createBucket(CreateBucketRequest.builder()
                    .bucket(storageProperties.getBucket())
                    .build());
            log.info("Created MinIO bucket: {}", storageProperties.getBucket());
        }
    }
}
