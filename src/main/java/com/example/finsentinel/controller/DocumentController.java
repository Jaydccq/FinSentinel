package com.example.finsentinel.controller;

import com.example.finsentinel.dto.document.DocumentUploadResponse;
import com.example.finsentinel.ratelimit.RateLimit;
import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.enums.DocumentStatus;
import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.document.DocumentUploadService;
import com.example.finsentinel.service.storage.StorageService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.UUID;

/**
 * REST controller for document upload and management.
 * Provides endpoints for RAG document ingestion, listing, and lookup.
 */
@Slf4j
@RestController
@RequestMapping("/api/documents")
@RequiredArgsConstructor
public class DocumentController {

    private final DocumentUploadService documentUploadService;
    private final DocumentRepository documentRepository;
    private final StorageService storageService;
    private final UserRepository userRepository;

    /**
     * Uploads and processes a document through the RAG pipeline.
     *
     * @param file the document file to upload
     * @param docType the document type classification
     * @param sector the financial sector (optional)
     * @param regionId the compliance region (optional, defaults to "US")
     * @return upload response with document metadata
     */
    @RateLimit(limit = 20, windowSecs = 60, key = "document:upload")
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<DocumentUploadResponse> uploadDocument(
            @RequestParam("file") MultipartFile file,
            @RequestParam("docType") DocumentType docType,
            @RequestParam(value = "sector", required = false) String sector,
            @RequestParam(value = "regionId", required = false, defaultValue = "US") String regionId,
            @AuthenticationPrincipal UserDetails userDetails) {

        log.info("POST /api/documents - file={}, docType={}, sector={}, regionId={}",
                file.getOriginalFilename(), docType, sector, regionId);

        UUID userId = resolveUserId(userDetails);
        DocumentUploadResponse response = documentUploadService.upload(file, docType, sector, regionId, userId);
        return ResponseEntity.ok(response);
    }

    /**
     * Lists documents with optional filtering by status and type.
     *
     * @param status optional status filter
     * @param docType optional document type filter
     * @return page of documents sorted by creation date descending
     */
    @GetMapping
    public ResponseEntity<Page<DocumentUploadResponse>> listDocuments(
            @RequestParam(value = "status", required = false) DocumentStatus status,
            @RequestParam(value = "docType", required = false) DocumentType docType,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size,
            @AuthenticationPrincipal UserDetails userDetails) {

        log.info("GET /api/documents - status={}, docType={}, page={}, size={}", status, docType, page, size);
        UUID userId = resolveUserId(userDetails);
        int safePage = Math.max(page, 0);
        int safeSize = Math.max(1, Math.min(size, 200));
        Pageable pageable = PageRequest.of(safePage, safeSize);

        Page<Document> documents;

        if (status != null && docType != null) {
            documents = documentRepository.findByUserIdAndStatusAndDocTypeOrderByCreatedAtDesc(
                    userId, status, docType, pageable);
        } else if (status != null) {
            documents = documentRepository.findByUserIdAndStatusOrderByCreatedAtDesc(userId, status, pageable);
        } else if (docType != null) {
            documents = documentRepository.findByUserIdAndDocTypeOrderByCreatedAtDesc(userId, docType, pageable);
        } else {
            documents = documentRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable);
        }

        Page<DocumentUploadResponse> responses = documents.map(this::toResponse);
        return ResponseEntity.ok(responses);
    }

    /**
     * Retrieves a single document by ID.
     *
     * @param id the document UUID
     * @return document metadata
     * @throws IllegalArgumentException if document not found
     */
    @GetMapping("/{id}")
    public ResponseEntity<DocumentUploadResponse> getDocument(@PathVariable UUID id,
                                                              @AuthenticationPrincipal UserDetails userDetails) {
        log.info("GET /api/documents/{}", id);
        Document document = findOwnedDocument(id, resolveUserId(userDetails));
        return ResponseEntity.ok(toResponse(document));
    }

    /**
     * Downloads a document file by ID.
     * Returns the raw file bytes with Content-Disposition attachment header.
     */
    @GetMapping("/{id}/download")
    public ResponseEntity<byte[]> downloadDocument(@PathVariable UUID id,
                                                   @AuthenticationPrincipal UserDetails userDetails) {
        log.info("GET /api/documents/{}/download", id);
        Document document = findOwnedDocument(id, resolveUserId(userDetails));

        byte[] content = storageService.download(document.getStorageKey());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename(document.getOriginalFileName())
                .build());
        MediaType mediaType = MediaTypeFactory.getMediaType(document.getOriginalFileName())
                .orElse(MediaType.APPLICATION_OCTET_STREAM);
        headers.setContentType(mediaType);

        return ResponseEntity.ok()
                .headers(headers)
                .body(content);
    }

    /**
     * Deletes a document by ID — removes from storage and database.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteDocument(@PathVariable UUID id,
                                               @AuthenticationPrincipal UserDetails userDetails) {
        log.info("DELETE /api/documents/{}", id);
        Document document = findOwnedDocument(id, resolveUserId(userDetails));

        try {
            storageService.delete(document.getStorageKey());
        } catch (Exception e) {
            log.warn("Failed to delete document from storage: {}", e.getMessage());
        }

        documentRepository.delete(document);
        return ResponseEntity.noContent().build();
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
                document.getStorageTier(),
                document.getArchivedAt(),
                document.getCreatedAt()
        );
    }

    private UUID resolveUserId(UserDetails userDetails) {
        if (userDetails == null) {
            throw new IllegalStateException("Authenticated user not found");
        }
        return userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new IllegalStateException("User not found"))
                .getId();
    }

    private Document findOwnedDocument(UUID id, UUID userId) {
        return documentRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new IllegalArgumentException("Document not found: " + id));
    }
}
