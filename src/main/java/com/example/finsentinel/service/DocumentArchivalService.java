package com.example.finsentinel.service;

import com.example.finsentinel.config.ArchivalProperties;
import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.enums.DocumentStatus;
import com.example.finsentinel.model.enums.StorageTier;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.service.storage.StorageService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Scheduled job that archives COMPLETED documents from RustFS (hot) to Google Drive (cold)
 * and cleans up FAILED documents from RustFS.
 */
@Slf4j
@Service
@ConditionalOnProperty(name = "app.archival.enabled", havingValue = "true")
public class DocumentArchivalService {

    private final DocumentRepository documentRepository;
    private final StorageService hotStorage;
    private final StorageService coldStorage;
    private final ArchivalProperties archivalProperties;

    public DocumentArchivalService(
            DocumentRepository documentRepository,
            @Qualifier("rustfsStorage") StorageService hotStorage,
            @Qualifier("googleDriveStorage") StorageService coldStorage,
            ArchivalProperties archivalProperties) {
        this.documentRepository = documentRepository;
        this.hotStorage = hotStorage;
        this.coldStorage = coldStorage;
        this.archivalProperties = archivalProperties;
    }

    @Scheduled(cron = "${app.archival.cron:0 0 2 * * *}")
    public void runArchival() {
        log.info("Starting document archival job");
        archiveCompletedDocuments();
        cleanFailedDocuments();
        log.info("Document archival job completed");
    }

    private void archiveCompletedDocuments() {
        LocalDateTime threshold = LocalDateTime.now().minusDays(archivalProperties.getRetentionDays());
        List<Document> candidates = documentRepository.findByStatusAndStorageTierAndCreatedAtBefore(
                DocumentStatus.COMPLETED, StorageTier.HOT, threshold,
                PageRequest.of(0, archivalProperties.getBatchSize()));

        log.info("Found {} COMPLETED documents eligible for archival", candidates.size());

        for (Document doc : candidates) {
            try {
                byte[] content = hotStorage.download(doc.getStorageKey());
                coldStorage.upload(doc.getStorageKey(), content, "application/pdf");
                hotStorage.delete(doc.getStorageKey());

                doc.setStorageTier(StorageTier.COLD);
                doc.setArchivedAt(LocalDateTime.now());
                documentRepository.save(doc);

                log.info("Archived document {} to cold storage", doc.getId());
            } catch (Exception e) {
                log.error("Failed to archive document {}: {}", doc.getId(), e.getMessage());
            }
        }
    }

    private void cleanFailedDocuments() {
        LocalDateTime threshold = LocalDateTime.now().minusDays(archivalProperties.getFailedRetentionDays());
        List<Document> candidates = documentRepository.findByStatusAndStorageTierAndCreatedAtBefore(
                DocumentStatus.FAILED, StorageTier.HOT, threshold,
                PageRequest.of(0, archivalProperties.getBatchSize()));

        log.info("Found {} FAILED documents eligible for cleanup", candidates.size());

        for (Document doc : candidates) {
            try {
                hotStorage.delete(doc.getStorageKey());

                doc.setStorageTier(StorageTier.DELETED);
                documentRepository.save(doc);

                log.info("Cleaned up failed document {}", doc.getId());
            } catch (Exception e) {
                log.error("Failed to clean up document {}: {}", doc.getId(), e.getMessage());
            }
        }
    }
}
