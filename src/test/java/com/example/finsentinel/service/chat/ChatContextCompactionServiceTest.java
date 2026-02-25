package com.example.finsentinel.service.chat;

import com.example.finsentinel.agent.RiskAgentService;
import com.example.finsentinel.config.ChatCompactionProperties;
import com.example.finsentinel.model.ChatMessage;
import com.example.finsentinel.model.ChatSessionMemory;
import com.example.finsentinel.repository.ChatMessageRepository;
import com.example.finsentinel.repository.ChatSessionMemoryRepository;
import com.example.finsentinel.service.event.AgentEventService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ChatContextCompactionServiceTest {

    @Mock private ChatMessageRepository chatMessageRepository;
    @Mock private ChatSessionMemoryRepository memoryRepository;
    @Mock private RiskAgentService riskAgentService;
    @Mock private AgentEventService agentEventService;

    private ChatContextCompactionService service;

    @BeforeEach
    void setUp() {
        ChatCompactionProperties properties = new ChatCompactionProperties();
        properties.setEnabled(true);
        properties.setThresholdMessages(3);
        properties.setRecentWindow(2);
        properties.setMaxSummaryChars(300);
        service = new ChatContextCompactionService(
                chatMessageRepository,
                memoryRepository,
                riskAgentService,
                agentEventService,
                properties
        );
    }

    @Test
    void augmentPrompt_longConversation_shouldCompactAndIncludeSummary() {
        UUID userId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        List<ChatMessage> messages = List.of(
                msg("user", "hello"),
                msg("assistant", "hi"),
                msg("user", "analyze tech portfolio risk"),
                msg("assistant", "here are the risks"),
                msg("user", "focus on drawdown"),
                msg("assistant", "noted")
        );
        when(chatMessageRepository.findTop100BySessionIdAndUserIdOrderByCreatedAtAsc(sessionId, userId))
                .thenReturn(messages);
        when(memoryRepository.findByUserIdAndSessionId(userId, sessionId)).thenReturn(Optional.empty());
        when(riskAgentService.quickChat(any())).thenReturn("User prefers conservative risk posture.");
        when(memoryRepository.save(any(ChatSessionMemory.class))).thenAnswer(inv -> inv.getArgument(0));

        String augmented = service.augmentPrompt(userId, sessionId, "what should I do next?");

        assertThat(augmented).contains("[Conversation Summary]");
        assertThat(augmented).contains("conservative risk posture");
        assertThat(augmented).contains("[Recent Conversation]");
        assertThat(augmented).contains("[Current User Message]");
        verify(memoryRepository).save(any(ChatSessionMemory.class));
    }

    private ChatMessage msg(String role, String content) {
        return ChatMessage.builder()
                .role(role)
                .content(content)
                .build();
    }
}
