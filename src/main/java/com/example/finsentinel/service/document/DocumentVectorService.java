package com.example.finsentinel.service.document;

import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.service.rag.DocumentChunkingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.filter.Filter;
import org.springframework.ai.vectorstore.filter.FilterExpressionBuilder;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Service for vectorizing documents and storing embeddings in pgvector.
 * Uses Spring AI VectorStore abstraction with metadata filtering support.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DocumentVectorService {

    private final VectorStore vectorStore;
    private final DocumentChunkingService documentChunkingService;

    /**
     * Executes vectorize.
     *
     * <p>This method belongs to {@link DocumentVectorService} and encapsulates the
     * vectorize workflow.
     * @param documentId document id (UUID)
     * @param text text (String)
     * @param docType doc type (DocumentType)
     * @param sector sector (String)
     * @param regionId region id (String)
     * @param source source (String)
     * @return the vectorize result (int)
     */

    public int vectorize(UUID documentId, String text, DocumentType docType,
                         String sector, String regionId, String source) {
        log.info("Vectorizing document: {} (type={}, sector={}, region={})", documentId, docType, sector, regionId);

        Map<String, Object> metadata = new HashMap<>();
        metadata.put("doc_id", documentId.toString());
        metadata.put("doc_type", docType.name());
        metadata.put("source", source);
        metadata.put("region_id", regionId != null ? regionId : "US");
        metadata.put("date", LocalDate.now().toString());

        if (sector != null && !sector.isBlank()) {
            metadata.put("sector", sector);
        }

        // Split into chunks with metadata
        List<org.springframework.ai.document.Document> chunks = documentChunkingService.split(text, metadata);

        log.debug("Split document {} into {} chunks", documentId, chunks.size());

        // Store embeddings in vector store
        vectorStore.add(chunks);

        log.info("Successfully vectorized {} chunks for document {}", chunks.size(), documentId);


        return chunks.size();
    }

    /**
     * Deletes all vector chunks associated with a document ID.
     * Note: This implementation searches for chunks first using metadata filter,
     * then deletes by their IDs.
     *
     * @param documentId the document UUID to delete chunks for
     */
    public void deleteByDocumentId(UUID documentId) {
        log.info("Deleting vector chunks for document: {}", documentId);

        try {
            // Build filter expression for doc_id metadata
            FilterExpressionBuilder builder = new FilterExpressionBuilder();
            Filter.Expression filterExpr = builder.eq("doc_id", documentId.toString()).build();

            SearchRequest searchRequest = SearchRequest.builder()
                    .query("document")
                    .topK(10000)
                    .filterExpression(filterExpr)
                    .similarityThreshold(0.0)
                    .build();

            List<org.springframework.ai.document.Document> chunks = vectorStore.similaritySearch(searchRequest);

            if (!chunks.isEmpty()) {
                List<String> chunkIds = chunks.stream()
                        .map(org.springframework.ai.document.Document::getId)
                        .toList();

                // Delete chunks by their IDs
                vectorStore.delete(chunkIds);
                log.info("Successfully deleted {} vector chunks for document {}", chunkIds.size(), documentId);
            } else {
                log.info("No vector chunks found for document {}", documentId);
            }

        } catch (Exception e) {
            log.error("Failed to delete vector chunks for document {}", documentId, e);

            throw new RuntimeException("Failed to delete document vectors: " + e.getMessage(), e);
        }
    }
}
