package com.example.finsentinel.controller;

import com.example.finsentinel.model.User;
import com.example.finsentinel.ratelimit.RateLimit;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.okx.OkxAnalysisService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;

/**
 * SSE streaming endpoints for AI-powered crypto derivatives analysis.
 *
 * <p>Exposes two streaming endpoints that pipe {@link OkxAnalysisService}
 * Flux output through Spring MVC {@link SseEmitter}, following the same
 * pattern as {@link AnalysisController} and {@link ChatController}.
 *
 * <p>Gated by {@code app.trading.okx.enabled=true} — the controller is
 * not created unless OKX integration is explicitly enabled.
 */
@RestController
@RequestMapping("/api/okx")
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(name = "app.trading.okx.enabled", havingValue = "true")
public class OkxAnalysisController {

    private final OkxAnalysisService okxAnalysisService;
    private final UserRepository userRepository;

    /** Maximum characters allowed in a single streamed response (~50KB). */
    private static final int MAX_STREAM_CHARS = 50_000;

    /**
     * Stream AI analysis for a single OKX instrument.
     *
     * <p>Validates the instrument ID format, resolves the authenticated user,
     * and streams the LLM response token-by-token via SSE events:
     * <ul>
     *   <li>{@code event: message} — each text chunk as {@code {"content": "..."}} </li>
     *   <li>{@code event: done} — signals stream completion</li>
     *   <li>{@code event: error} — signals an error with {@code {"message": "..."}}</li>
     * </ul>
     *
     * @param instId OKX instrument ID, e.g. "BTC-USDT-SWAP"
     * @param userDetails the authenticated user principal
     * @return SSE emitter streaming the analysis
     */
    @RateLimit(limit = 5, windowSecs = 300, key = "okx:analysis:stream")
    @PostMapping(value = "/analysis/stream/{instId}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamAnalysis(
            @PathVariable String instId,
            @AuthenticationPrincipal UserDetails userDetails) {

        if (!instId.matches("^[A-Za-z0-9\\-]{1,30}$")) {
            throw new IllegalArgumentException("Invalid instrument ID format");
        }

        User user = userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));

        log.info("OKX analysis stream requested for instId={} by userId={}", instId, user.getId());

        SseEmitter emitter = new SseEmitter(180_000L);
        StringBuilder fullResponse = new StringBuilder();

        okxAnalysisService.streamAnalysis(instId)
                .doOnNext(chunk -> {
                    try {
                        fullResponse.append(chunk);
                        if (fullResponse.length() > MAX_STREAM_CHARS) {
                            log.warn("OKX analysis stream exceeded {} chars for instId={}, truncating",
                                    MAX_STREAM_CHARS, instId);
                            emitter.send(SseEmitter.event()
                                    .name("message")
                                    .data(Map.of("content",
                                            "\n\n[Analysis truncated — output exceeded maximum length.]")));
                            emitter.send(SseEmitter.event().name("done").data("[DONE]"));
                            emitter.complete();
                            return;
                        }
                        emitter.send(SseEmitter.event()
                                .name("message")
                                .data(Map.of("content", chunk)));
                    } catch (IOException e) {
                        emitter.completeWithError(e);
                    }
                })
                .doOnComplete(() -> {
                    try {
                        emitter.send(SseEmitter.event().name("done").data("[DONE]"));
                    } catch (IOException ignored) {
                    }
                    emitter.complete();
                })
                .doOnError(error -> {
                    log.error("OKX analysis stream error for instId={}", instId, error);
                    try {
                        emitter.send(SseEmitter.event().name("error")
                                .data(Map.of("message", "Analysis failed. Please try again.")));
                    } catch (IOException ignored) {
                    }
                    emitter.completeWithError(error);
                })
                .subscribe();

        return emitter;
    }

    /**
     * Stream AI portfolio health check across all open OKX positions.
     *
     * <p>Resolves the authenticated user and delegates to
     * {@link OkxAnalysisService#streamHealthCheck(java.util.UUID)}.
     * Uses the same SSE event pattern as {@link #streamAnalysis(String, UserDetails)}.
     *
     * @param userDetails the authenticated user principal
     * @return SSE emitter streaming the health check
     */
    @RateLimit(limit = 5, windowSecs = 300, key = "okx:analysis:health")
    @PostMapping(value = "/analysis/health-check", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamHealthCheck(
            @AuthenticationPrincipal UserDetails userDetails) {

        User user = userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "User not found"));

        log.info("OKX health check stream requested by userId={}", user.getId());

        SseEmitter emitter = new SseEmitter(180_000L);
        StringBuilder fullResponse = new StringBuilder();

        okxAnalysisService.streamHealthCheck(user.getId())
                .doOnNext(chunk -> {
                    try {
                        fullResponse.append(chunk);
                        if (fullResponse.length() > MAX_STREAM_CHARS) {
                            log.warn("OKX health check stream exceeded {} chars for userId={}, truncating",
                                    MAX_STREAM_CHARS, user.getId());
                            emitter.send(SseEmitter.event()
                                    .name("message")
                                    .data(Map.of("content",
                                            "\n\n[Health check truncated — output exceeded maximum length.]")));
                            emitter.send(SseEmitter.event().name("done").data("[DONE]"));
                            emitter.complete();
                            return;
                        }
                        emitter.send(SseEmitter.event()
                                .name("message")
                                .data(Map.of("content", chunk)));
                    } catch (IOException e) {
                        emitter.completeWithError(e);
                    }
                })
                .doOnComplete(() -> {
                    try {
                        emitter.send(SseEmitter.event().name("done").data("[DONE]"));
                    } catch (IOException ignored) {
                    }
                    emitter.complete();
                })
                .doOnError(error -> {
                    log.error("OKX health check stream error for userId={}", user.getId(), error);
                    try {
                        emitter.send(SseEmitter.event().name("error")
                                .data(Map.of("message", "Health check failed. Please try again.")));
                    } catch (IOException ignored) {
                    }
                    emitter.completeWithError(error);
                })
                .subscribe();

        return emitter;
    }
}
