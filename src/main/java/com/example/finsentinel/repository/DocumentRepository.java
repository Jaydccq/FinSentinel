package com.example.finsentinel.repository;

import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.enums.DocumentStatus;
import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.model.enums.StorageTier;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Declares persistence operations for document repository data.
 *
 * <p>This interface is part of the repository layer in FinSentinel.
 */

public interface DocumentRepository extends JpaRepository<Document, UUID> {


    List<Document> findByStatusOrderByCreatedAtDesc(DocumentStatus status);


    List<Document> findByDocTypeOrderByCreatedAtDesc(DocumentType docType);


    List<Document> findByStatusAndDocTypeOrderByCreatedAtDesc(DocumentStatus status, DocumentType docType);


    boolean existsByOriginalFileName(String originalFileName);

    List<Document> findByStatusAndStorageTierAndCreatedAtBefore(
            DocumentStatus status, StorageTier storageTier, LocalDateTime threshold, Pageable pageable);
}
