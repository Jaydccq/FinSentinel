package com.example.finsentinel.dto.document;

import com.example.finsentinel.model.enums.DocumentStatus;
import com.example.finsentinel.model.enums.DocumentType;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Response DTO for document upload operations.
 * Returns essential metadata after document processing and vectorization.
 */
public record DocumentUploadResponse(
        UUID id,
        String fileName,
        DocumentType docType,
        DocumentStatus status,
        String sector,
        String regionId,
        Long fileSize,
        Integer chunkCount,
        LocalDateTime createdAt
) {}
