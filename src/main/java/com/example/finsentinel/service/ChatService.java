package com.example.finsentinel.service;

import com.example.finsentinel.agent.RiskAgentService;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.model.ChatMessage;
import com.example.finsentinel.repository.ChatMessageRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class ChatService {

    private final RiskAgentService riskAgentService;
    private final ChatMessageRepository chatMessageRepository;

    /**
     * Stream AI response via SSE (typewriter effect).
     * Persists both user and assistant messages.
     */
    public void streamChat(String message, UUID sessionId, UUID portfolioId,
                           UUID userId, SseEmitter emitter) {
        UUID session = sessionId != null ? sessionId : UUID.randomUUID();

        persistMessage(userId, session, "user", message);

        StringBuilder fullResponse = new StringBuilder();
        riskAgentService.assessStream(message, portfolioId)
                .doOnNext(chunk -> {
                    try {
                        fullResponse.append(chunk);
                        emitter.send(SseEmitter.event()
                                .name("message")
                                .data(Map.of("content", chunk, "sessionId", session.toString())));
                    } catch (IOException e) {
                        emitter.completeWithError(e);
                    }
                })
                .doOnComplete(() -> {
                    persistMessage(userId, session, "assistant", fullResponse.toString());
                    try {
                        emitter.send(SseEmitter.event().name("done").data("[DONE]"));
                    } catch (IOException ignored) {
                    }
                    emitter.complete();
                })
                .doOnError(error -> {
                    log.error("Stream error for session {}", session, error);
                    try {
                        emitter.send(SseEmitter.event().name("error")
                                .data(Map.of("message", error.getMessage())));
                    } catch (IOException ignored) {
                    }
                    emitter.completeWithError(error);
                })
                .subscribe();
    }

    /**
     * Non-streaming structured risk assessment.
     */
    public RiskReport assess(String message, UUID portfolioId, UUID userId, UUID sessionId) {
        UUID session = sessionId != null ? sessionId : UUID.randomUUID();
        persistMessage(userId, session, "user", message);
        RiskReport report = riskAgentService.assess(message, portfolioId);
        persistMessage(userId, session, "assistant", report.toString());
        return report;
    }

    public List<ChatMessage> getSessionHistory(UUID sessionId) {
        return chatMessageRepository.findBySessionIdOrderByCreatedAtAsc(sessionId);
    }

    public List<ChatMessage> getUserHistory(UUID userId) {
        return chatMessageRepository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    private void persistMessage(UUID userId, UUID sessionId, String role, String content) {
        chatMessageRepository.save(ChatMessage.builder()
                .userId(userId)
                .sessionId(sessionId)
                .role(role)
                .content(content)
                .build());
    }
}
