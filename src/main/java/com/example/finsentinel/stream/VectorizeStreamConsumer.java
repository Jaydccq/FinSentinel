package com.example.finsentinel.stream;

import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.enums.DocumentStatus;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.service.document.DocumentParseService;
import com.example.finsentinel.service.document.DocumentVectorService;
import com.example.finsentinel.service.storage.StorageService;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.stream.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Consumer for Redis Stream-based async document vectorization.
 * Reads tasks from stream, downloads files from RustFS, parses, vectorizes,
 * and updates document status. Implements retry logic with exponential backoff.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class VectorizeStreamConsumer {

    private final StringRedisTemplate redisTemplate;
    private final DocumentRepository documentRepository;
    private final DocumentParseService documentParseService;
    private final DocumentVectorService documentVectorService;
    private final StorageService storageService;
    private final VectorizeStreamProducer vectorizeStreamProducer;

    private final String consumerName = "consumer-" + UUID.randomUUID().toString().substring(0, 8);

    /**
     * Initializes the Redis Stream consumer group.
     * Creates the group on first startup; ignores error if group already exists.
     */
    @PostConstruct
    public void init() {
        try {
            redisTemplate.opsForStream().createGroup(
                    VectorizeStreamConstants.STREAM_KEY,
                    ReadOffset.from("0"),
                    VectorizeStreamConstants.GROUP_NAME);
            log.info("Created consumer group: {}", VectorizeStreamConstants.GROUP_NAME);
        } catch (Exception e) {
            // Group already exists — this is expected on restart
            log.debug("Consumer group already exists: {}", VectorizeStreamConstants.GROUP_NAME);
        }
    }

    /**
     * Polls for messages from Redis Stream every second.
     * Uses consumer group with blocking read for efficient consumption.
     */
    @Scheduled(fixedDelay = 1000)
    public void consume() {
        try {
            List<MapRecord<String, Object, Object>> messages = redisTemplate.opsForStream().read(
                    Consumer.from(VectorizeStreamConstants.GROUP_NAME, consumerName),
                    StreamReadOptions.empty().count(5).block(Duration.ofMillis(500)),
                    StreamOffset.create(VectorizeStreamConstants.STREAM_KEY, ReadOffset.lastConsumed())
            );

            if (messages == null || messages.isEmpty()) {
                return;
            }

            for (MapRecord<String, Object, Object> message : messages) {
                processMessage(message);
            }
        } catch (Exception e) {
            log.error("Error consuming from vectorize stream", e);
        }
    }

    /**
     * Processes a single vectorization task message.
     * Downloads file from RustFS, parses to clean text, vectorizes, and updates status.
     * Implements retry logic: re-sends task with incremented retry count on failure,
     * or marks as FAILED if max retries exceeded.
     *
     * @param message the Redis Stream message record
     */
    private void processMessage(MapRecord<String, Object, Object> message) {
        Map<Object, Object> body = message.getValue();
        String documentIdStr = (String) body.get(VectorizeStreamConstants.FIELD_DOCUMENT_ID);
        String retryCountStr = (String) body.getOrDefault(VectorizeStreamConstants.FIELD_RETRY_COUNT, "0");
        int retryCount = Integer.parseInt(retryCountStr);

        UUID documentId;
        try {
            documentId = UUID.fromString(documentIdStr);
        } catch (Exception e) {
            log.error("Invalid documentId in message: {}", documentIdStr);
            ack(message);
            return;
        }

        // Check if document still exists (may have been deleted)
        Document document = documentRepository.findById(documentId).orElse(null);
        if (document == null) {
            log.warn("Document not found, skipping: {}", documentId);
            ack(message);
            return;
        }

        try {
            // Update status to PROCESSING
            document.setStatus(DocumentStatus.PROCESSING);
            documentRepository.save(document);

            // Download from RustFS and parse
            byte[] fileBytes = storageService.download(document.getStorageKey());
            String cleanText = documentParseService.parseToCleanText(fileBytes, document.getOriginalFileName());

            // Vectorize
            int chunkCount = documentVectorService.vectorize(
                    document.getId(),
                    cleanText,
                    document.getDocType(),
                    document.getSector(),
                    document.getRegionId(),
                    document.getOriginalFileName()
            );

            // Update status to COMPLETED
            document.setChunkCount(chunkCount);
            document.setStatus(DocumentStatus.COMPLETED);
            documentRepository.save(document);

            log.info("Vectorized document {}: {} chunks (retry={})", documentId, chunkCount, retryCount);

        } catch (Exception e) {
            log.error("Failed to vectorize document {} (retry={})", documentId, retryCount, e);

            if (retryCount < VectorizeStreamConstants.MAX_RETRIES) {
                // Re-send with incremented retry count
                vectorizeStreamProducer.send(documentId, retryCount + 1);
            } else {
                // Max retries exceeded — mark as FAILED
                document.setStatus(DocumentStatus.FAILED);
                documentRepository.save(document);
                log.error("Document {} failed after {} retries", documentId, VectorizeStreamConstants.MAX_RETRIES);
            }
        } finally {
            // Always ACK the original message
            ack(message);
        }
    }

    /**
     * Acknowledges a message in the Redis Stream consumer group.

     * This removes the message from the pending entries list (PEL).
     *
     * @param message the message to acknowledge
     */
    private void ack(MapRecord<String, Object, Object> message) {
        redisTemplate.opsForStream().acknowledge(
                VectorizeStreamConstants.STREAM_KEY,
                VectorizeStreamConstants.GROUP_NAME,
                message.getId()
        );
    }
}
