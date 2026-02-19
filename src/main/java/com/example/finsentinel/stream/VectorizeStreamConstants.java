package com.example.finsentinel.stream;

/**
 * Constants for Redis Stream-based async document vectorization.
 * Defines stream key, consumer group name, message field keys, and retry policy.
 */
public final class VectorizeStreamConstants {
    /**
     * Creates a new VectorizeStreamConstants instance.
     *
     * <p>This method is defined in {@link VectorizeStreamConstants}.
     */

    private VectorizeStreamConstants() {}

    public static final String STREAM_KEY = "stream:vectorize";
    public static final String GROUP_NAME = "vectorize-group";
    public static final int MAX_LEN = 1000;
    public static final int MAX_RETRIES = 3;

    // Message field keys
    public static final String FIELD_DOCUMENT_ID = "documentId";
    public static final String FIELD_RETRY_COUNT = "retryCount";

    // News enrichment stream
    public static final String NEWS_ENRICH_STREAM_KEY = "stream:news-enrich";
    public static final String NEWS_ENRICH_GROUP_NAME = "news-enrich-group";
    public static final String FIELD_NEWS_ITEM_ID = "newsItemId";
}
