package com.example.finsentinel.controller;

import com.example.finsentinel.dto.chat.ChatMessageResponse;
import com.example.finsentinel.dto.chat.ChatRequest;
import com.example.finsentinel.dto.chat.ChatSessionSummary;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.model.ChatMessage;
import com.example.finsentinel.model.User;
import com.example.finsentinel.ratelimit.RateLimit;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.ChatService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.UUID;

/**
 * Exposes REST endpoints for chat controller operations.
 *
 * <p>This class belongs to the controller layer in FinSentinel.
 */

@RestController
@RequestMapping("/api/chat")
@RequiredArgsConstructor
public class ChatController {

    private final ChatService chatService;
    private final UserRepository userRepository;

    /**
     * Executes stream chat.
     *
     * <p>This method is defined in {@link ChatController}.
     * @param request request (ChatRequest)
     * @param portfolioId portfolio id (UUID)
     * @param userDetails user details (UserDetails)
     * @return the stream chat result (SseEmitter)
     */

    @RateLimit(limit = 10, windowSecs = 60, key = "chat:stream")
    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamChat(
            @Valid @RequestBody ChatRequest request,
            @RequestParam(required = false) UUID portfolioId,
            @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        SseEmitter emitter = new SseEmitter(120_000L);
        chatService.streamChat(request.message(), request.sessionId(),
                portfolioId, user.getId(), emitter);
        return emitter;
    }

    /**
     * Executes assess.
     *
     * <p>This method is defined in {@link ChatController}.
     * @param request request (ChatRequest)
     * @param portfolioId portfolio id (UUID)
     * @param userDetails user details (UserDetails)
     * @return the assess result (ResponseEntity<RiskReport>)
     */

    @RateLimit(limit = 10, windowSecs = 60, key = "chat:assess")
    @PostMapping("/assess")
    public ResponseEntity<RiskReport> assess(
            @Valid @RequestBody ChatRequest request,
            @RequestParam(required = false) UUID portfolioId,
            @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        RiskReport report = chatService.assess(request.message(), portfolioId,
                user.getId(), request.sessionId());

        return ResponseEntity.ok(report);
    }

    /**
     * Lists all distinct chat sessions for the authenticated user.
     */
    @GetMapping("/sessions")
    public ResponseEntity<List<ChatSessionSummary>> listSessions(
            @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        return ResponseEntity.ok(chatService.listSessions(user.getId()));
    }

    /**
     * Returns session history.
     *
     * <p>This method belongs to {@link ChatController} and encapsulates the
     * get session history workflow.
     * @param sessionId session id (UUID)
     * @return the get session history result (ResponseEntity<List<ChatMessageResponse>>)
     */

    @GetMapping("/sessions/{sessionId}")
    public ResponseEntity<List<ChatMessageResponse>> getSessionHistory(
            @PathVariable UUID sessionId,
            @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        return ResponseEntity.ok(chatService.getSessionHistory(sessionId, user.getId()).stream()
                .map(this::toResponse).toList());
    }

    /**
     * Executes resolve user.
     *
     * <p>This method belongs to {@link ChatController} and encapsulates the
     * resolve user workflow.
     * @param userDetails user details (UserDetails)
     * @return the resolve user result (User)
     */

    private User resolveUser(UserDetails userDetails) {
        return userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new IllegalStateException("User not found"));
    }

    /**
     * Executes to response.
     *
     * <p>This method belongs to {@link ChatController} and encapsulates the
     * to response workflow.
     * @param msg msg (ChatMessage)
     * @return the to response result (ChatMessageResponse)
     */

    private ChatMessageResponse toResponse(ChatMessage msg) {

        return new ChatMessageResponse(msg.getId(), msg.getSessionId(),
                msg.getRole(), msg.getContent(), msg.getCreatedAt());
    }
}
