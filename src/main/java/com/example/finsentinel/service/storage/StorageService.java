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
