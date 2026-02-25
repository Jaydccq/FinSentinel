package com.example.finsentinel.stream;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.stream.*;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

/**
 * Abstract template for Redis Stream consumers.
 * Encapsulates consumer group initialization, polling, pending message reclamation, and acknowledgement.
 * Subclasses only need to implement {@link #processMessage(MapRecord)} with domain-specific logic.
 */
@Slf4j
public abstract class AbstractStreamConsumer {

    protected final StringRedisTemplate redisTemplate;
    protected final String streamKey;
    protected final String groupName;
    protected final String consumerName;

    protected AbstractStreamConsumer(StringRedisTemplate redisTemplate,
                                      String streamKey,
                                      String groupName,
                                      String consumerPrefix) {
        this.redisTemplate = redisTemplate;
        this.streamKey = streamKey;
        this.groupName = groupName;
        this.consumerName = consumerPrefix + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    @PostConstruct
    public void init() {
        try {
            redisTemplate.opsForStream().createGroup(streamKey, ReadOffset.from("0"), groupName);
            log.info("Created consumer group: {}", groupName);
        } catch (Exception e) {
            log.debug("Consumer group already exists: {}", groupName);
        }
    }

    protected void doPoll() {
        try {
            List<MapRecord<String, Object, Object>> messages = redisTemplate.opsForStream().read(
                    Consumer.from(groupName, consumerName),
                    StreamReadOptions.empty().count(5).block(Duration.ofMillis(500)),
                    StreamOffset.create(streamKey, ReadOffset.lastConsumed())
            );
            if (messages == null || messages.isEmpty()) return;
            for (MapRecord<String, Object, Object> message : messages) {
                processMessage(message);
            }
        } catch (Exception e) {
            log.error("Error consuming from stream {}", streamKey, e);
        }
    }

    protected void doReclaimPending() {
        try {
            PendingMessages pending = redisTemplate.opsForStream().pending(
                    streamKey, groupName, Range.unbounded(), 10L);
            for (PendingMessage pm : pending) {
                if (pm.getElapsedTimeSinceLastDelivery().compareTo(Duration.ofSeconds(30)) > 0
                        && !pm.getConsumerName().equals(consumerName)) {
                    try {
                        List<MapRecord<String, Object, Object>> claimed =
                                redisTemplate.opsForStream().claim(
                                        streamKey, groupName, consumerName,
                                        Duration.ofSeconds(30),
                                        RecordId.of(pm.getId().getValue()));
                        for (MapRecord<String, Object, Object> msg : claimed) {
                            log.info("Reclaimed pending message {} from consumer {}",
                                    msg.getId(), pm.getConsumerName());
                            processMessage(msg);
                        }
                    } catch (Exception e) {
                        log.warn("Failed to reclaim message {}: {}", pm.getId(), e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Error checking pending messages on {}: {}", streamKey, e.getMessage());
        }
    }

    protected abstract void processMessage(MapRecord<String, Object, Object> message);

    protected void ack(MapRecord<String, Object, Object> message) {
        redisTemplate.opsForStream().acknowledge(streamKey, groupName, message.getId());
    }
}
