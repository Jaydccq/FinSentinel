package com.example.finsentinel.stream;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.stream.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

/**
 * Producer for sending document vectorization tasks to Redis Stream.
 * Uses StringRedisTemplate for lightweight string-based messages with trim policy
 * to prevent unbounded stream growth.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class VectorizeStreamProducer {

    private final StringRedisTemplate redisTemplate;

    /**
     * Sends a vectorize task for a document with retry count 0.
     *
     * @param documentId the document UUID to vectorize
     */
    public void send(UUID documentId) {
        send(documentId, 0);
    }

    /**
     * Sends a vectorize task with a specified retry count.
     *
     * @param documentId the document UUID to vectorize
     * @param retryCount the current retry attempt number
     */
    public void send(UUID documentId, int retryCount) {
        Map<String, String> message = Map.of(
                VectorizeStreamConstants.FIELD_DOCUMENT_ID, documentId.toString(),
                VectorizeStreamConstants.FIELD_RETRY_COUNT, String.valueOf(retryCount)
        );

        StringRecord record = StreamRecords.string(message)
                .withStreamKey(VectorizeStreamConstants.STREAM_KEY);

        RecordId recordId = redisTemplate.opsForStream().add(record);

        // Trim stream to maxLen to prevent unbounded growth
        redisTemplate.opsForStream().trim(VectorizeStreamConstants.STREAM_KEY,
                VectorizeStreamConstants.MAX_LEN, true);

        log.info("Sent vectorize task: documentId={}, retryCount={}, recordId={}",
                documentId, retryCount, recordId);
    }
}
