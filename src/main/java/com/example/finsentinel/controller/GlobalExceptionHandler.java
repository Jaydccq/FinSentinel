package com.example.finsentinel.controller;

import com.example.finsentinel.ratelimit.RateLimitExceededException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import lombok.extern.slf4j.Slf4j;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * Exposes REST endpoints for global exception handler operations.
 *
 * <p>This class is part of the controller layer in FinSentinel.
 */

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    /**
     * Executes handle rate limit.
     *
     * <p>This method is defined in {@link GlobalExceptionHandler}.
     * @param ex ex (RateLimitExceededException)
     * @return the handle rate limit result (ResponseEntity<Map<String, Object>>)
     */

    @ExceptionHandler(RateLimitExceededException.class)
    public ResponseEntity<Map<String, Object>> handleRateLimit(RateLimitExceededException ex) {
        Map<String, Object> body = new HashMap<>();
        body.put("timestamp", LocalDateTime.now());
        body.put("status", HttpStatus.TOO_MANY_REQUESTS.value());
        body.put("message", "Too many requests. Please slow down.");
        body.put("retryAfterMs", ex.getRetryAfterMs());

        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", String.valueOf(ex.getRetryAfterMs() / 1000))
                .body(body);
    }

    /**
     * Executes handle illegal argument.
     *
     * <p>This method is defined in {@link GlobalExceptionHandler}.
     * @param ex ex (IllegalArgumentException)
     * @return the handle illegal argument result (ResponseEntity<Map<String, Object>>)
     */

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgument(IllegalArgumentException ex) {

        return buildResponse(HttpStatus.BAD_REQUEST, ex.getMessage());
    }

    /**
     * Executes handle bad credentials.
     *
     * <p>This method is defined in {@link GlobalExceptionHandler}.
     * @param ex ex (BadCredentialsException)
     * @return the handle bad credentials result (ResponseEntity<Map<String, Object>>)
     */

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<Map<String, Object>> handleBadCredentials(BadCredentialsException ex) {

        return buildResponse(HttpStatus.UNAUTHORIZED, "Invalid username or password");
    }

    /**
     * Executes handle validation.
     *
     * <p>This method is defined in {@link GlobalExceptionHandler}.
     * @param ex ex (MethodArgumentNotValidException)
     * @return the handle validation result (ResponseEntity<Map<String, Object>>)
     */

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getAllErrors().forEach(error -> {
            String fieldName = ((FieldError) error).getField();
            String errorMessage = error.getDefaultMessage();
            errors.put(fieldName, errorMessage);
        });
        Map<String, Object> body = new HashMap<>();
        body.put("timestamp", LocalDateTime.now());
        body.put("status", HttpStatus.BAD_REQUEST.value());
        body.put("errors", errors);

        return ResponseEntity.badRequest().body(body);
    }

    /**
     * Executes handle runtime.
     *
     * <p>This method is defined in {@link GlobalExceptionHandler}.
     * @param ex ex (RuntimeException)
     * @return the handle runtime result (ResponseEntity<Map<String, Object>>)
     */

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String, Object>> handleRuntime(RuntimeException ex) {
        log.error("Unhandled runtime exception", ex);
        return buildResponse(HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error");
    }

    /**
     * Builds response.
     *
     * <p>This method belongs to {@link GlobalExceptionHandler} and encapsulates the
     * build response workflow.
     * @param status status (HttpStatus)
     * @param message message (String)
     * @return the build response result (ResponseEntity<Map<String, Object>>)
     */

    private ResponseEntity<Map<String, Object>> buildResponse(HttpStatus status, String message) {
        Map<String, Object> body = new HashMap<>();
        body.put("timestamp", LocalDateTime.now());
        body.put("status", status.value());
        body.put("message", message);

        return ResponseEntity.status(status).body(body);
    }
}
