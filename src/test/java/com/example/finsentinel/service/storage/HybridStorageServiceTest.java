package com.example.finsentinel.service.storage;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class HybridStorageServiceTest {

    @Mock private StorageService hotStorage;
    @Mock private StorageService coldStorage;

    private HybridStorageService hybridService;

    @BeforeEach
    void setUp() {
        hybridService = new HybridStorageService(hotStorage, coldStorage);
    }

    @Test
    void uploadWritesToHotStorage() {
        byte[] content = "test".getBytes();
        hybridService.upload("key.pdf", content, "application/pdf");

        verify(hotStorage).upload("key.pdf", content, "application/pdf");
        verifyNoInteractions(coldStorage);
    }

    @Test
    void downloadReturnsFromHotStorage() {
        byte[] expected = "hot data".getBytes();
        when(hotStorage.download("key.pdf")).thenReturn(expected);

        byte[] result = hybridService.download("key.pdf");

        assertThat(result).isEqualTo(expected);
        verifyNoInteractions(coldStorage);
    }

    @Test
    void downloadFallsThroughToColdWhenHotFails() {
        byte[] expected = "cold data".getBytes();
        when(hotStorage.download("key.pdf")).thenThrow(new RuntimeException("Not found"));
        when(coldStorage.download("key.pdf")).thenReturn(expected);

        byte[] result = hybridService.download("key.pdf");

        assertThat(result).isEqualTo(expected);
        verify(hotStorage).download("key.pdf");
        verify(coldStorage).download("key.pdf");
    }

    @Test
    void deleteAffectsBothHotAndColdStorage() {
        hybridService.delete("key.pdf");

        verify(hotStorage).delete("key.pdf");
        verify(coldStorage).delete("key.pdf");
    }
}
