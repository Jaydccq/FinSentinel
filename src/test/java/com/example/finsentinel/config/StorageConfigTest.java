package com.example.finsentinel.config;

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
        assertThatThrownBy(() -> config.storageService(storageProps, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("unknown");
    }
}
