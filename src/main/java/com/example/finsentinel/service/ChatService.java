package com.example.finsentinel.service;

import com.example.finsentinel.agent.RiskAgentService;
import com.example.finsentinel.dto.chat.ChatSessionSummary;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.model.ChatMessage;
import com.example.finsentinel.repository.ChatMessageRepository;
import com.example.finsentinel.repository.PortfolioRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Implements chat service business operations and integrations.
 *
 * <p>This class is part of the service layer in FinSentinel.
 */

@Service
@RequiredArgsConstructor
@Slf4j
public class ChatService {

    private final RiskAgentService riskAgentService;
    private final ChatMessageRepository chatMessageRepository;
    private final PortfolioRepository portfolioRepository;

    /**

     * Stream AI response via SSE (typewriter effect).
     * Persists both user and assistant messages.
     */
    public void streamChat(String message, UUID sessionId, UUID portfolioId,
                           UUID userId, SseEmitter emitter) {
        ensurePortfolioOwnership(portfolioId, userId);
        UUID session = sessionId != null ? sessionId : UUID.randomUUID();

        persistMessage(userId, session, "user", message);

        StringBuilder fullResponse = new StringBuilder();
        riskAgentService.assessStream(message, portfolioId, userId)
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
                                .data(Map.of("message", "An error occurred while processing your request. Please try again.")));
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
        ensurePortfolioOwnership(portfolioId, userId);
        UUID session = sessionId != null ? sessionId : UUID.randomUUID();
        persistMessage(userId, session, "user", message);
        RiskReport report = riskAgentService.assess(message, portfolioId, userId);
        persistMessage(userId, session, "assistant", report.toString());
        return report;
    }

    /**
     * Returns session history.
     *
     * <p>This method belongs to {@link ChatService} and encapsulates the
     * get session history workflow.
     * @param sessionId session id (UUID)
     * @return the get session history result (List<ChatMessage>)
     */

    public List<ChatMessage> getSessionHistory(UUID sessionId, UUID userId) {

        return chatMessageRepository.findTop100BySessionIdAndUserIdOrderByCreatedAtAsc(sessionId, userId);
    }

    /**
     * Returns user history.
     *
     * <p>This method belongs to {@link ChatService} and encapsulates the
     * get user history workflow.
     * @param userId user id (UUID)
     * @return the get user history result (List<ChatMessage>)
     */

    public List<ChatMessage> getUserHistory(UUID userId) {

        return chatMessageRepository.findTop50ByUserIdOrderByCreatedAtDesc(userId);
    }

    /**
     * Lists distinct chat sessions for a user, ordered by most recent activity.
     * Uses database-level aggregation to avoid loading all messages into memory.
     */
    public List<ChatSessionSummary> listSessions(UUID userId) {
        return chatMessageRepository.findSessionSummaries(userId).stream()
                .map(p -> {
                    String msg = p.getFirstMessage();
                    if (msg == null) msg = "New conversation";
                    else if (msg.length() > 80) msg = msg.substring(0, 80) + "…";
                    return new ChatSessionSummary(
                            p.getSessionId(),
                            msg,
                            p.getMessageCount(),
                            p.getCreatedAt(),
                            p.getLastMessageAt()
                    );
                })
                .toList();
    }

    private void persistMessage(UUID userId, UUID sessionId, String role, String content) {
        chatMessageRepository.save(ChatMessage.builder()
                .userId(userId)
                .sessionId(sessionId)
                .role(role)
                .content(content)
                .build());
    }

    private void ensurePortfolioOwnership(UUID portfolioId, UUID userId) {
        if (portfolioId == null) {
            return;
        }
        if (!portfolioRepository.existsByIdAndUserId(portfolioId, userId)) {
            throw new IllegalArgumentException("Portfolio not found");
        }
    }
}
