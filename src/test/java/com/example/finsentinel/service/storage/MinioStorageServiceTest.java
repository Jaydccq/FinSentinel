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
