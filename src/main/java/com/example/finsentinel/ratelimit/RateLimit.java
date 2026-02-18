package com.example.finsentinel.ratelimit;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declarative rate limiting via Redis + Lua sliding-window counter.
 * <p>
 * Place on controller methods. The AOP aspect resolves the rate-limit key
 * from the authenticated user (preferred) or the client IP address.
 *
 * <pre>{@code
 * @RateLimit(limit = 10, windowSecs = 60)
 * @PostMapping("/stream")
 * public SseEmitter stream(...) { ... }
 * }</pre>
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RateLimit {

    /** Maximum number of requests allowed within the window. */
    int limit() default 60;

    /** Window duration in seconds. */
    int windowSecs() default 60;

    /**
     * Endpoint key used in the Redis key.
     * Defaults to empty string — the aspect will derive it from the method name.
     */
    String key() default "";
}
