package com.example.finsentinel.config;

import com.example.finsentinel.service.storage.StorageService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Configuration
public class TestStorageConfig {

    @Bean
    @Primary
    public StorageService inMemoryStorageService() {
        Map<String, byte[]> storage = new ConcurrentHashMap<>();
        return new StorageService() {
            @Override
            public void upload(String key, byte[] content, String contentType) {
                storage.put(key, content);
            }

            @Override
            public byte[] download(String key) {
                byte[] content = storage.get(key);
                if (content == null) {
                    throw new IllegalArgumentException("File not found: " + key);
                }
                return content;
            }

            @Override
            public void delete(String key) {
                storage.remove(key);
            }
        };
    }
}
