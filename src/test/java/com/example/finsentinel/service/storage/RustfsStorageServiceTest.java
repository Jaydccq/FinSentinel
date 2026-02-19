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
