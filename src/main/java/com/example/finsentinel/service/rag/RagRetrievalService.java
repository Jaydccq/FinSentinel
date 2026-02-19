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
 * for document type, sector, regulatory region, and date.
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

        return search(query, topK, docType, sector, regionId, null);
    }

    /**
     * Search with temporal filtering support.
     *
     * @param query      the user's search query
     * @param topK       number of results to return
     * @param docType    optional filter by doc_type
     * @param sector     optional filter by sector
     * @param regionId   optional filter by region_id

     * @param afterDate  optional date filter in ISO format (YYYY-MM-DD), only return docs indexed on or after this date
     * @return matching document chunks sorted by relevance
     */
    public List<Document> search(String query, int topK, String docType, String sector, String regionId, String afterDate) {
        String filterExpression = buildFilterExpression(docType, sector, regionId, afterDate);

        SearchRequest searchRequest = SearchRequest.builder()
                .query(query)
                .topK(topK)
                .similarityThreshold(0.65)
                .filterExpression(filterExpression)
                .build();

        List<Document> results = vectorStore.similaritySearch(searchRequest);
        log.info("RAG search: query='{}', topK={}, filters=[docType={}, sector={}, region={}, afterDate={}], found={}",
                truncate(query, 50), topK, docType, sector, regionId, afterDate, results.size());
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
     * Builds filter expression.
     *
     * <p>This method belongs to {@link RagRetrievalService} and encapsulates the
     * build filter expression workflow.
     * @param docType doc type (String)
     * @param sector sector (String)
     * @param regionId region id (String)
     * @param afterDate after date (String)
     * @return the build filter expression result (String)
     */

    private String buildFilterExpression(String docType, String sector, String regionId, String afterDate) {
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
        if (afterDate != null && !afterDate.isBlank()) {
            conditions.add("date >= '" + escapeFilterValue(afterDate) + "'");
        }

        if (conditions.isEmpty()) {
            return null;
        }


        return String.join(" && ", conditions);
    }

    /**
     * Executes escape filter value.
     *
     * <p>This method belongs to {@link RagRetrievalService} and encapsulates the
     * escape filter value workflow.
     * @param value value (String)
     * @return the escape filter value result (String)
     */

    private String escapeFilterValue(String value) {

        return value.replace("'", "\\'");
    }

    /**
     * Executes truncate.
     *
     * <p>This method belongs to {@link RagRetrievalService} and encapsulates the
     * truncate workflow.
     * @param text text (String)
     * @param maxLen max len (int)
     * @return the truncate result (String)
     */

    private String truncate(String text, int maxLen) {

        return text.length() <= maxLen ? text : text.substring(0, maxLen) + "...";
    }
}
