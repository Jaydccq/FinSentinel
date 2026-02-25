package com.example.finsentinel.service.chat;

import com.example.finsentinel.agent.RiskAgentService;
import com.example.finsentinel.config.ChatCompactionProperties;
import com.example.finsentinel.model.ChatMessage;
import com.example.finsentinel.model.ChatSessionMemory;
import com.example.finsentinel.model.enums.AgentEventAggregateType;
import com.example.finsentinel.model.enums.AgentEventType;
import com.example.finsentinel.repository.ChatMessageRepository;
import com.example.finsentinel.repository.ChatSessionMemoryRepository;
import com.example.finsentinel.service.event.AgentEventService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Builds compacted long-context prompts to keep chat sessions scalable.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ChatContextCompactionService {

    private final ChatMessageRepository chatMessageRepository;
    private final ChatSessionMemoryRepository memoryRepository;
    private final RiskAgentService riskAgentService;
    private final AgentEventService agentEventService;
    private final ChatCompactionProperties properties;

    @Transactional
    public String augmentPrompt(UUID userId, UUID sessionId, String userMessage) {
        if (!properties.isEnabled() || sessionId == null || userMessage == null) {
            return userMessage;
        }

        List<ChatMessage> messages = chatMessageRepository.findTop100BySessionIdAndUserIdOrderByCreatedAtAsc(sessionId, userId);
        if (messages.isEmpty()) {
            return userMessage;
        }

        int recentWindow = Math.max(2, properties.getRecentWindow());
        int compactableCount = Math.max(0, messages.size() - recentWindow);

        ChatSessionMemory memory = memoryRepository.findByUserIdAndSessionId(userId, sessionId).orElse(null);
        if (compactableCount >= properties.getThresholdMessages() && shouldRecompact(memory, compactableCount)) {
            memory = compactAndSave(userId, sessionId, messages.subList(0, compactableCount), compactableCount, memory);
        }

        String summary = memory != null ? memory.getSummaryText() : "";
        List<ChatMessage> recentMessages = messages.subList(Math.max(0, messages.size() - recentWindow), messages.size());

        StringBuilder builder = new StringBuilder();
        if (!summary.isBlank()) {
            builder.append("[Conversation Summary]\n").append(summary).append("\n\n");
        }
        builder.append("[Recent Conversation]\n");
        for (ChatMessage msg : recentMessages) {
            builder.append(msg.getRole().toUpperCase())
                    .append(": ")
                    .append(truncate(msg.getContent(), 300))
                    .append("\n");
        }
        builder.append("\n[Current User Message]\n").append(userMessage);
        return builder.toString();
    }

    private boolean shouldRecompact(ChatSessionMemory memory, int compactableCount) {
        if (memory == null) {
            return true;
        }
        return compactableCount - memory.getCompactedMessageCount() >= 4;
    }

    private ChatSessionMemory compactAndSave(UUID userId,
                                             UUID sessionId,
                                             List<ChatMessage> messagesToCompact,
                                             int compactedCount,
                                             ChatSessionMemory existing) {
        String compactedSummary = summarize(messagesToCompact, existing != null ? existing.getSummaryText() : "");
        ChatSessionMemory memory = existing != null ? existing : ChatSessionMemory.builder()
                .userId(userId)
                .sessionId(sessionId)
                .build();
        memory.setSummaryText(compactedSummary);
        memory.setCompactedMessageCount(compactedCount);
        ChatSessionMemory saved = memoryRepository.save(memory);
        emitCompactionEvent(userId, sessionId, compactedCount, compactedSummary.length());
        return saved;
    }

    private String summarize(List<ChatMessage> messagesToCompact, String previousSummary) {
        String transcript = messagesToCompact.stream()
                .map(m -> m.getRole().toUpperCase() + ": " + truncate(m.getContent(), 220))
                .reduce("", (a, b) -> a.isBlank() ? b : a + "\n" + b);

        String prompt = """
                You are compressing long chat history for an investment assistant.
                Keep key facts, user constraints, risk preferences, open questions, and unresolved tasks.
                Output concise plain text under %d characters.

                Previous summary:
                %s

                New transcript chunk:
                %s
                """.formatted(properties.getMaxSummaryChars(), previousSummary == null ? "" : previousSummary, transcript);
        try {
            String summary = riskAgentService.quickChat(prompt);
            return truncate(summary == null ? "" : summary.strip(), properties.getMaxSummaryChars());
        } catch (Exception e) {
            log.warn("Chat compaction LLM summary failed, using fallback: {}", e.getMessage());
            return truncate(buildFallbackSummary(messagesToCompact), properties.getMaxSummaryChars());
        }
    }

    private String buildFallbackSummary(List<ChatMessage> messages) {
        return messages.stream()
                .skip(Math.max(0, messages.size() - 12L))
                .map(m -> m.getRole().toUpperCase() + ": " + truncate(m.getContent(), 100))
                .reduce("", (a, b) -> a.isBlank() ? b : a + "\n" + b);
    }

    private void emitCompactionEvent(UUID userId, UUID sessionId, int compactedCount, int summaryLength) {
        try {
            agentEventService.append(
                    userId,
                    AgentEventAggregateType.CHAT_SESSION,
                    sessionId,
                    AgentEventType.CHAT_CONTEXT_COMPACTED,
                    Map.of("compactedMessages", compactedCount, "summaryLength", summaryLength),
                    null
            );
        } catch (Exception e) {
            log.warn("Failed to emit context compaction event for session {}: {}", sessionId, e.getMessage());
        }
    }

    private String truncate(String text, int maxLen) {
        if (text == null) {
            return "";
        }
        return text.length() <= maxLen ? text : text.substring(0, maxLen) + "...";
    }
}
