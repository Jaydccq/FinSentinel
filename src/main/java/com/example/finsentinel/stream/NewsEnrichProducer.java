package com.example.finsentinel.stream;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.data.redis.connection.stream.StringRecord;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
public class NewsEnrichProducer {

    private final StringRedisTemplate redisTemplate;

    public void send(UUID newsItemId) {
        send(newsItemId, 0);
    }

    public void send(UUID newsItemId, int retryCount) {
        Map<String, String> message = Map.of(
                VectorizeStreamConstants.FIELD_NEWS_ITEM_ID, newsItemId.toString(),
                VectorizeStreamConstants.FIELD_RETRY_COUNT, String.valueOf(retryCount)
        );

        StringRecord record = StreamRecords.string(message)
                .withStreamKey(VectorizeStreamConstants.NEWS_ENRICH_STREAM_KEY);

        RecordId recordId = redisTemplate.opsForStream().add(record);

        redisTemplate.opsForStream().trim(VectorizeStreamConstants.NEWS_ENRICH_STREAM_KEY,
                VectorizeStreamConstants.MAX_LEN, true);

        log.info("Sent news enrich task: newsItemId={}, retryCount={}, recordId={}",
                newsItemId, retryCount, recordId);
    }
}
