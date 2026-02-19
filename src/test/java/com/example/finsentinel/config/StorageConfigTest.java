package com.example.finsentinel.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class StorageConfigTest {

    @Test
    void rustfsProviderIsDefault() {
        StorageProperties props = new StorageProperties();
        assertThat(props.getProvider()).isEqualTo("rustfs");
    }

    @Test
    void archivalDisabledByDefault() {
        ArchivalProperties props = new ArchivalProperties();
        assertThat(props.isEnabled()).isFalse();
        assertThat(props.getRetentionDays()).isEqualTo(7);
        assertThat(props.getFailedRetentionDays()).isEqualTo(3);
        assertThat(props.getBatchSize()).isEqualTo(50);
    }
}
