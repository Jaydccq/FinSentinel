package com.example.finsentinel.controller;

import com.example.finsentinel.dto.chat.ChatMessageResponse;
import com.example.finsentinel.dto.chat.ChatRequest;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.model.ChatMessage;
import com.example.finsentinel.model.User;
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

@RestController
@RequestMapping("/api/chat")
@RequiredArgsConstructor
public class ChatController {

    private final ChatService chatService;
    private final UserRepository userRepository;

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

    @GetMapping("/sessions/{sessionId}")
    public ResponseEntity<List<ChatMessageResponse>> getSessionHistory(
            @PathVariable UUID sessionId) {
        return ResponseEntity.ok(chatService.getSessionHistory(sessionId).stream()
                .map(this::toResponse).toList());
    }

    private User resolveUser(UserDetails userDetails) {
        return userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new IllegalStateException("User not found"));
    }

    private ChatMessageResponse toResponse(ChatMessage msg) {
        return new ChatMessageResponse(msg.getId(), msg.getSessionId(),
                msg.getRole(), msg.getContent(), msg.getCreatedAt());
    }
}
