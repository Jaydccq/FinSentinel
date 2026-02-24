package com.example.finsentinel.service.storage;

import lombok.extern.slf4j.Slf4j;

/**
 * Transparent hybrid storage proxy: writes always go to hot (RustFS),
 * reads try hot first then fall back to cold (Google Drive).
 */
@Slf4j
public class HybridStorageService implements StorageService {

    private final StorageService hotStorage;
    private final StorageService coldStorage;

    public HybridStorageService(StorageService hotStorage, StorageService coldStorage) {
        this.hotStorage = hotStorage;
        this.coldStorage = coldStorage;
    }

    @Override
    public void upload(String key, byte[] content, String contentType) {
        hotStorage.upload(key, content, contentType);
    }

    @Override
    public byte[] download(String key) {
        try {
            return hotStorage.download(key);
        } catch (Exception e) {
            log.info("Hot storage miss for {}, falling back to cold storage", key);
            return coldStorage.download(key);
        }
    }

    @Override
    public void delete(String key) {
        try {
            hotStorage.delete(key);
        } catch (Exception e) {
            log.warn("Failed to delete from hot storage: {}", key, e);
        }
        try {
            coldStorage.delete(key);
        } catch (Exception e) {
            log.warn("Failed to delete from cold storage: {}", key, e);
        }
    }
}
