package com.example.finsentinel.ratelimit;

/**
 * Thrown when a rate limit is exceeded. Carries the retry-after duration in milliseconds.
 */
public class RateLimitExceededException extends RuntimeException {

    private final long retryAfterMs;

    /**
     * Creates a new RateLimitExceededException instance.
     *
     * <p>This method is defined in {@link RateLimitExceededException}.
     * @param retryAfterMs retry after ms (long)
     */

    public RateLimitExceededException(long retryAfterMs) {
        super("Rate limit exceeded. Retry after " + retryAfterMs + "ms.");
        this.retryAfterMs = retryAfterMs;
    }

    /**
     * Returns retry after ms.
     *
     * <p>This method belongs to {@link RateLimitExceededException} and encapsulates the
     * get retry after ms workflow.
     * @return the get retry after ms result (long)
     */

    public long getRetryAfterMs() {
        return retryAfterMs;
    }
}
