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

@Service
@Slf4j
public class MinioStorageService {

    private final S3Client s3Client;
    private final StorageProperties storageProperties;

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

    public void upload(String key, byte[] content, String contentType) {
        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(storageProperties.getBucket())
                .key(key)
                .contentType(contentType)
                .build();
        s3Client.putObject(request, RequestBody.fromBytes(content));
        log.info("Uploaded {} ({} bytes) to MinIO", key, content.length);
    }

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
            log.info("Created MinIO bucket: {}", storageProperties.getBucket());
        }
    }
}
