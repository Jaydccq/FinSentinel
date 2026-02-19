package com.example.finsentinel.service;

import com.example.finsentinel.config.ArchivalProperties;
import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.enums.DocumentStatus;
import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.model.enums.StorageTier;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.service.storage.StorageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class DocumentArchivalServiceTest {

    @Mock private DocumentRepository documentRepository;
    @Mock private StorageService hotStorage;
    @Mock private StorageService coldStorage;

    private ArchivalProperties archivalProperties;
    private DocumentArchivalService archivalService;

    @BeforeEach
    void setUp() {
        archivalProperties = new ArchivalProperties();
        archivalProperties.setEnabled(true);
        archivalProperties.setRetentionDays(7);
        archivalProperties.setFailedRetentionDays(3);
        archivalProperties.setBatchSize(50);

        archivalService = new DocumentArchivalService(
                documentRepository, hotStorage, coldStorage, archivalProperties);
    }

    @Test
    void archivesCompletedDocumentsToColdStorage() {
        Document doc = buildDocument(DocumentStatus.COMPLETED, StorageTier.HOT, "docs/report.pdf");
        byte[] content = "pdf bytes".getBytes();

        when(documentRepository.findByStatusAndStorageTierAndCreatedAtBefore(
                eq(DocumentStatus.COMPLETED), eq(StorageTier.HOT), any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of(doc));
        when(documentRepository.findByStatusAndStorageTierAndCreatedAtBefore(
                eq(DocumentStatus.FAILED), eq(StorageTier.HOT), any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of());
        when(hotStorage.download("docs/report.pdf")).thenReturn(content);

        archivalService.runArchival();

        verify(coldStorage).upload("docs/report.pdf", content, "application/pdf");
        verify(hotStorage).delete("docs/report.pdf");

        ArgumentCaptor<Document> captor = ArgumentCaptor.forClass(Document.class);
        verify(documentRepository, atLeastOnce()).save(captor.capture());
        Document saved = captor.getAllValues().get(0);
        assertThat(saved.getStorageTier()).isEqualTo(StorageTier.COLD);
        assertThat(saved.getArchivedAt()).isNotNull();
    }

    @Test
    void cleansFailedDocumentsWithoutArchiving() {
        Document doc = buildDocument(DocumentStatus.FAILED, StorageTier.HOT, "docs/bad.pdf");

        when(documentRepository.findByStatusAndStorageTierAndCreatedAtBefore(
                eq(DocumentStatus.COMPLETED), eq(StorageTier.HOT), any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of());
        when(documentRepository.findByStatusAndStorageTierAndCreatedAtBefore(
                eq(DocumentStatus.FAILED), eq(StorageTier.HOT), any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of(doc));

        archivalService.runArchival();

        verify(hotStorage).delete("docs/bad.pdf");
        verifyNoInteractions(coldStorage);

        ArgumentCaptor<Document> captor = ArgumentCaptor.forClass(Document.class);
        verify(documentRepository).save(captor.capture());
        assertThat(captor.getValue().getStorageTier()).isEqualTo(StorageTier.DELETED);
    }

    @Test
    void singleFailureDoesNotBlockBatch() {
        Document doc1 = buildDocument(DocumentStatus.COMPLETED, StorageTier.HOT, "docs/a.pdf");
        Document doc2 = buildDocument(DocumentStatus.COMPLETED, StorageTier.HOT, "docs/b.pdf");
        byte[] content = "ok".getBytes();

        when(documentRepository.findByStatusAndStorageTierAndCreatedAtBefore(
                eq(DocumentStatus.COMPLETED), eq(StorageTier.HOT), any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of(doc1, doc2));
        when(documentRepository.findByStatusAndStorageTierAndCreatedAtBefore(
                eq(DocumentStatus.FAILED), eq(StorageTier.HOT), any(LocalDateTime.class), any(Pageable.class)))
                .thenReturn(List.of());
        when(hotStorage.download("docs/a.pdf")).thenThrow(new RuntimeException("S3 error"));
        when(hotStorage.download("docs/b.pdf")).thenReturn(content);

        archivalService.runArchival();

        // doc1 failed, doc2 should still be archived
        verify(coldStorage, never()).upload(eq("docs/a.pdf"), any(), any());
        verify(coldStorage).upload("docs/b.pdf", content, "application/pdf");
        verify(documentRepository, times(1)).save(doc2);
    }

    private Document buildDocument(DocumentStatus status, StorageTier tier, String storageKey) {
        return Document.builder()
                .id(UUID.randomUUID())
                .fileName("test.pdf")
                .originalFileName("test.pdf")
                .docType(DocumentType.SEC_FILING)
                .status(status)
                .storageTier(tier)
                .storageKey(storageKey)
                .createdAt(LocalDateTime.now().minusDays(30))
                .build();
    }
}
