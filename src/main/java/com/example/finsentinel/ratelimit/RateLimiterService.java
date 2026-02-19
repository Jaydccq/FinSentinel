package com.example.finsentinel.ratelimit;

import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.scripting.support.ResourceScriptSource;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Distributed rate limiter backed by Redis + Lua fixed-window counter.
 * <p>
 * Key format: {@code rl:{dimension}:{identifier}:{endpoint}}
 * <br>
 * Thread-safe: Lua script executes atomically on Redis.
 */
@Service
@Slf4j
public class RateLimiterService {

    private final StringRedisTemplate redisTemplate;
    @SuppressWarnings("rawtypes")
    private final DefaultRedisScript<List> rateLimitScript;

    /**
     * Creates a new RateLimiterService instance.
     *
     * <p>This method is defined in {@link RateLimiterService}.
     * @param redisTemplate redis template (StringRedisTemplate)
     */

    @SuppressWarnings("rawtypes")
    public RateLimiterService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
        this.rateLimitScript = new DefaultRedisScript<>();
        this.rateLimitScript.setScriptSource(
                new ResourceScriptSource(new ClassPathResource("lua/rate_limit.lua")));
        this.rateLimitScript.setResultType(List.class);
    }

    /**
     * Check and increment the rate limit counter.
     *
     * @param dimension  grouping dimension, e.g. "user" or "ip"
     * @param identifier the value, e.g. userId or IP address
     * @param endpoint   the specific operation key, e.g. "chat:stream"
     * @param windowSecs sliding window size in seconds
     * @param limit      max requests per window
     * @return RateLimitResult with allowed flag, remaining count, and retryAfterMs
     */
    public RateLimitResult check(String dimension, String identifier,
                                  String endpoint, int windowSecs, int limit) {
        String key = buildKey(dimension, identifier, endpoint);
        @SuppressWarnings("unchecked")
        List<Long> result = (List<Long>) redisTemplate.execute(
                rateLimitScript,
                List.of(key),
                String.valueOf(windowSecs),
                String.valueOf(limit));

        if (result == null || result.size() < 3) {
            log.warn("Unexpected Lua script result for key {}, allowing request", key);

            return new RateLimitResult(true, limit, 0);
        }

        boolean allowed = result.get(0) == 1L;
        long remaining = result.get(1);
        long retryAfterMs = result.get(2);

        log.debug("Rate limit check [{}]: allowed={}, remaining={}, retryAfterMs={}",
                key, allowed, remaining, retryAfterMs);

        return new RateLimitResult(allowed, remaining, retryAfterMs);
    }

    /**
     * Builds key.
     *
     * <p>This method belongs to {@link RateLimiterService} and encapsulates the
     * build key workflow.
     * @param dimension dimension (String)
     * @param identifier identifier (String)
     * @param endpoint endpoint (String)
     * @return the build key result (String)
     */

    private String buildKey(String dimension, String identifier, String endpoint) {
        return "rl:" + dimension + ":" + identifier + ":" + endpoint;
    }
}
