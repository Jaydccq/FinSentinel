package com.example.finsentinel.service.rag;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Service for RAG (Retrieval-Augmented Generation) document retrieval with metadata filtering.
 * Provides semantic search against the pgvector-backed knowledge base with optional filters
 * for document type, sector, and regulatory region.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RagRetrievalService {

    private final VectorStore vectorStore;

    /**
     * Search for relevant document chunks with optional metadata filters.
     * Uses pgvector HNSW index with cosine distance for semantic similarity.
     *
     * @param query      the user's search query (will be embedded with OpenAI)
     * @param topK       number of results to return
     * @param docType    optional filter by doc_type (e.g., "SEC_FILING", "REGULATION")
     * @param sector     optional filter by sector (e.g., "technology")
     * @param regionId   optional filter by region_id (e.g., "US")
     * @return matching document chunks sorted by relevance (cosine similarity)
     */
    public List<Document> search(String query, int topK, String docType, String sector, String regionId) {
        // Build filter expression string from non-null parameters
        String filterExpression = buildFilterExpression(docType, sector, regionId);

        SearchRequest searchRequest = SearchRequest.builder()
                .query(query)
                .topK(topK)
                .similarityThreshold(0.7)
                .filterExpression(filterExpression)
                .build();

        List<Document> results = vectorStore.similaritySearch(searchRequest);
        log.info("RAG search: query='{}', topK={}, filters=[docType={}, sector={}, region={}], found={}",
                truncate(query, 50), topK, docType, sector, regionId, results.size());
        return results;
    }

    /**
     * Simple search with default topK=5 and no filters.
     *
     * @param query the user's search query
     * @return top 5 matching document chunks
     */
    public List<Document> search(String query) {
        return search(query, 5, null, null, null);
    }

    /**
     * Build a combined filter expression string from optional parameters.
     * Uses AND (&&) to combine multiple filters.
     * Returns null if no filters are provided.
     *
     * @param docType  optional doc_type metadata filter
     * @param sector   optional sector metadata filter
     * @param regionId optional region_id metadata filter
     * @return combined filter expression string or null if no filters provided
     */
    private String buildFilterExpression(String docType, String sector, String regionId) {
        List<String> conditions = new ArrayList<>();

        if (docType != null && !docType.isBlank()) {
            conditions.add("doc_type == '" + escapeFilterValue(docType) + "'");
        }
        if (sector != null && !sector.isBlank()) {
            conditions.add("sector == '" + escapeFilterValue(sector) + "'");
        }
        if (regionId != null && !regionId.isBlank()) {
            conditions.add("region_id == '" + escapeFilterValue(regionId) + "'");
        }

        if (conditions.isEmpty()) {
            return null;
        }

        return String.join(" && ", conditions);
    }

    /**
     * Escape single quotes in filter values to prevent injection.
     *
     * @param value the filter value to escape
     * @return escaped value safe for filter expression
     */
    private String escapeFilterValue(String value) {
        return value.replace("'", "\\'");
    }

    /**
     * Truncate text for logging.
     *
     * @param text   the text to truncate
     * @param maxLen maximum length before truncation
     * @return truncated text with ellipsis if needed
     */
    private String truncate(String text, int maxLen) {
        return text.length() <= maxLen ? text : text.substring(0, maxLen) + "...";
    }
}
