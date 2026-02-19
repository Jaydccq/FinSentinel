package com.example.finsentinel.controller;

import com.example.finsentinel.dto.document.DocumentUploadResponse;
import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.enums.DocumentStatus;
import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.service.document.DocumentUploadService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Sort;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

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

    /**
     * Uploads and processes a document through the RAG pipeline.
     *
     * @param file the document file to upload
     * @param docType the document type classification
     * @param sector the financial sector (optional)
     * @param regionId the compliance region (optional, defaults to "US")
     * @return upload response with document metadata
     */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<DocumentUploadResponse> uploadDocument(
            @RequestParam("file") MultipartFile file,
            @RequestParam("docType") DocumentType docType,
            @RequestParam(value = "sector", required = false) String sector,
            @RequestParam(value = "regionId", required = false, defaultValue = "US") String regionId) {

        log.info("POST /api/documents - file={}, docType={}, sector={}, regionId={}",
                file.getOriginalFilename(), docType, sector, regionId);

        DocumentUploadResponse response = documentUploadService.upload(file, docType, sector, regionId);
        return ResponseEntity.ok(response);
    }

    /**
     * Lists documents with optional filtering by status and type.
     *
     * @param status optional status filter
     * @param docType optional document type filter
     * @return list of documents sorted by creation date descending
     */
    @GetMapping
    public ResponseEntity<List<DocumentUploadResponse>> listDocuments(
            @RequestParam(value = "status", required = false) DocumentStatus status,
            @RequestParam(value = "docType", required = false) DocumentType docType) {

        log.info("GET /api/documents - status={}, docType={}", status, docType);

        List<Document> documents;

        if (status != null && docType != null) {
            documents = documentRepository.findByStatusAndDocType(status, docType);
        } else if (status != null) {
            // Status filter only
            documents = documentRepository.findByStatus(status);
        } else if (docType != null) {
            // Type filter only
            documents = documentRepository.findByDocType(docType);
        } else {
            // No filters
            documents = documentRepository.findAll(Sort.by(Sort.Direction.DESC, "createdAt"));
        }

        List<DocumentUploadResponse> responses = documents.stream()
                .map(this::toResponse)
                .collect(Collectors.toList());

        log.debug("Found {} documents", responses.size());
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
    public ResponseEntity<DocumentUploadResponse> getDocument(@PathVariable UUID id) {
        log.info("GET /api/documents/{}", id);

        Document document = documentRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Document not found: " + id));
        return ResponseEntity.ok(toResponse(document));
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
}
