package com.example.finsentinel.repository;

import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.enums.DocumentStatus;
import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.model.enums.StorageTier;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Page;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
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

    Optional<Document> findByIdAndUserId(UUID id, UUID userId);

    List<Document> findByUserIdOrderByCreatedAtDesc(UUID userId);

    List<Document> findByUserIdAndStatusOrderByCreatedAtDesc(UUID userId, DocumentStatus status);

    List<Document> findByUserIdAndDocTypeOrderByCreatedAtDesc(UUID userId, DocumentType docType);

    List<Document> findByUserIdAndStatusAndDocTypeOrderByCreatedAtDesc(UUID userId, DocumentStatus status, DocumentType docType);

    Page<Document> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    Page<Document> findByUserIdAndStatusOrderByCreatedAtDesc(UUID userId, DocumentStatus status, Pageable pageable);

    Page<Document> findByUserIdAndDocTypeOrderByCreatedAtDesc(UUID userId, DocumentType docType, Pageable pageable);

    Page<Document> findByUserIdAndStatusAndDocTypeOrderByCreatedAtDesc(UUID userId, DocumentStatus status, DocumentType docType, Pageable pageable);


    boolean existsByOriginalFileName(String originalFileName);

    List<Document> findByStatusAndStorageTierAndCreatedAtBefore(
            DocumentStatus status, StorageTier storageTier, LocalDateTime threshold, Pageable pageable);
}
