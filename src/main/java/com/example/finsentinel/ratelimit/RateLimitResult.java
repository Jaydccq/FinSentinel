package com.example.finsentinel.ratelimit;

/**
 * Result from a rate limit check.
 *
 * @param allowed       true if the request is within the allowed limit
 * @param remaining     remaining requests in the current window

 * @param retryAfterMs  milliseconds until the window resets (when not allowed)
 */
public record RateLimitResult(boolean allowed, long remaining, long retryAfterMs) {
}
