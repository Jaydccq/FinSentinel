package com.example.finsentinel.service.document;

import com.example.finsentinel.dto.document.DocumentUploadResponse;
import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.enums.DocumentStatus;
import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.service.storage.MinioStorageService;
import com.example.finsentinel.stream.VectorizeStreamProducer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Orchestrates document upload with async RAG vectorization via Redis Stream.
 * Handles file validation, storage, and task queueing for background processing.
 * Vectorization happens asynchronously in VectorizeStreamConsumer.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DocumentUploadService {

    private static final long MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

    private final DocumentParseService documentParseService;
    private final VectorizeStreamProducer vectorizeStreamProducer;
    private final MinioStorageService minioStorageService;
    private final DocumentRepository documentRepository;

    /**
     * Uploads a document and queues it for async vectorization via Redis Stream.
     * Returns immediately with PENDING status. Vectorization happens in background.
     *
     * @param file the multipart file to upload
     * @param docType the document type classification
     * @param sector the financial sector (optional)
     * @param regionId the compliance region (default "US")
     * @return upload response with document metadata (PENDING status)
     * @throws IllegalArgumentException if file validation fails
     * @throws RuntimeException if upload to storage fails
     */
    public DocumentUploadResponse upload(MultipartFile file, DocumentType docType, String sector, String regionId) {
        log.info("Starting document upload: filename={}, type={}, sector={}, region={}",
                file.getOriginalFilename(), docType, sector, regionId);

        // Validate file
        validateFile(file);

        Document document = null;
        try {
            // 1. Create JPA entity with PENDING status
            String storageKey = generateStorageKey(file.getOriginalFilename());
            document = Document.builder()
                    .id(UUID.randomUUID())
                    .fileName(storageKey)
                    .originalFileName(file.getOriginalFilename())
                    .docType(docType)
                    .status(DocumentStatus.PENDING)
                    .sector(sector)
                    .regionId(regionId != null ? regionId : "US")
                    .fileSize(file.getSize())
                    .storageKey(storageKey)
                    .createdAt(LocalDateTime.now())
                    .build();

            document = documentRepository.save(document);
            log.debug("Created document entity: {}", document.getId());

            // 2. Upload raw file to MinIO
            byte[] fileBytes = file.getBytes();
            minioStorageService.upload(storageKey, fileBytes, file.getContentType());
            log.debug("Uploaded file to MinIO: {}", storageKey);

            // 3. Validate file can be parsed (early validation before queuing)
            try {
                String cleanText = documentParseService.parseToCleanText(fileBytes, file.getOriginalFilename());
                log.debug("Validated document parsing: {} characters extracted", cleanText.length());
            } catch (Exception e) {
                log.error("Document parsing validation failed: {}", file.getOriginalFilename(), e);
                document.setStatus(DocumentStatus.FAILED);
                documentRepository.save(document);
                throw new IllegalArgumentException("File cannot be parsed: " + e.getMessage(), e);
            }

            // 4. Send vectorize task to Redis Stream
            vectorizeStreamProducer.send(document.getId());

            // 5. Return immediately — consumer will handle vectorization async
            log.info("Queued document {} for async vectorization", document.getId());
            return toResponse(document);

        } catch (IOException e) {
            log.error("IO error processing document: {}", file.getOriginalFilename(), e);
            if (document != null) {
                updateStatus(document, DocumentStatus.FAILED);
            }
            throw new RuntimeException("Failed to read file: " + e.getMessage(), e);

        } catch (Exception e) {
            log.error("Error processing document: {}", file.getOriginalFilename(), e);
            if (document != null) {
                updateStatus(document, DocumentStatus.FAILED);
            }
            throw new RuntimeException("Document processing failed: " + e.getMessage(), e);
        }
    }

    /**
     * Validates uploaded file meets requirements.
     */
    private void validateFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("File cannot be empty");
        }

        if (file.getSize() > MAX_FILE_SIZE) {
            throw new IllegalArgumentException(
                    String.format("File size exceeds maximum allowed size of %d MB", MAX_FILE_SIZE / 1024 / 1024)
            );
        }

        String filename = file.getOriginalFilename();
        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename cannot be blank");
        }
    }

    /**
     * Generates a unique storage key for the file.
     */
    private String generateStorageKey(String originalFilename) {
        String timestamp = String.valueOf(System.currentTimeMillis());
        String sanitized = originalFilename.replaceAll("[^a-zA-Z0-9._-]", "_");
        return "documents/" + timestamp + "_" + sanitized;
    }

    /**
     * Updates document status and saves to database.
     */
    private Document updateStatus(Document document, DocumentStatus status) {
        document.setStatus(status);
        return documentRepository.save(document);
    }

    /**
     * Converts JPA entity to response DTO.
     */
    private DocumentUploadResponse toResponse(Document document) {
        return new DocumentUploadResponse(
                document.getId(),
                document.getOriginalFileName(),
                document.getDocType(),
                document.getStatus(),
                document.getSector(),
                document.getRegionId(),
                document.getFileSize(),
                document.getChunkCount(),
                document.getCreatedAt()
        );
    }
}
