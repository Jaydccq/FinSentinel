package com.example.finsentinel.ratelimit;

/**
 * Thrown when a rate limit is exceeded. Carries the retry-after duration in milliseconds.
 */
public class RateLimitExceededException extends RuntimeException {

    private final long retryAfterMs;

    public RateLimitExceededException(long retryAfterMs) {
        super("Rate limit exceeded. Retry after " + retryAfterMs + "ms.");
        this.retryAfterMs = retryAfterMs;
    }

    public long getRetryAfterMs() {
        return retryAfterMs;
    }
}
