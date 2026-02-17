package com.example.finsentinel.service;

import com.example.finsentinel.agent.RiskAgentService;
import com.example.finsentinel.dto.risk.ComplianceNote;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.model.ChatMessage;
import com.example.finsentinel.repository.ChatMessageRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ChatServiceTest {

    @Mock private RiskAgentService riskAgentService;
    @Mock private ChatMessageRepository chatMessageRepository;

    private ChatService service;

    private final UUID userId = UUID.randomUUID();
    private final UUID portfolioId = UUID.randomUUID();
    private final UUID sessionId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new ChatService(riskAgentService, chatMessageRepository);
    }

    @Test
    void streamChat_shouldPersistUserMessageAndSubscribeToFlux() {
        when(chatMessageRepository.save(any(ChatMessage.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(riskAgentService.assessStream("Test question", portfolioId))
                .thenReturn(Flux.just("Hello", " World"));

        SseEmitter emitter = new SseEmitter(120_000L);
        service.streamChat("Test question", sessionId, portfolioId, userId, emitter);

        // Allow async operations to complete
        try { Thread.sleep(500); } catch (InterruptedException ignored) {}

        // Should persist user message immediately + assistant message after stream completes
        ArgumentCaptor<ChatMessage> captor = ArgumentCaptor.forClass(ChatMessage.class);
        verify(chatMessageRepository, atLeast(2)).save(captor.capture());

        List<ChatMessage> saved = captor.getAllValues();
        assertThat(saved.get(0).getRole()).isEqualTo("user");
        assertThat(saved.get(0).getContent()).isEqualTo("Test question");
        assertThat(saved.get(1).getRole()).isEqualTo("assistant");
        assertThat(saved.get(1).getContent()).isEqualTo("Hello World");
    }

    @Test
    void streamChat_shouldGenerateSessionIdIfNull() {
        when(chatMessageRepository.save(any(ChatMessage.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(riskAgentService.assessStream("Test", portfolioId))
                .thenReturn(Flux.just("Response"));

        SseEmitter emitter = new SseEmitter(120_000L);
        service.streamChat("Test", null, portfolioId, userId, emitter);

        try { Thread.sleep(500); } catch (InterruptedException ignored) {}

        ArgumentCaptor<ChatMessage> captor = ArgumentCaptor.forClass(ChatMessage.class);
        verify(chatMessageRepository, atLeast(1)).save(captor.capture());
        assertThat(captor.getValue().getSessionId()).isNotNull();
    }

    @Test
    void assess_shouldReturnRiskReportAndPersistMessages() {
        RiskReport report = new RiskReport(
                65, "HIGH", "Test risk", List.of(), List.of(),
                new ComplianceNote("Disclaimer", "SEC", true));
        when(riskAgentService.assess("Analyze AAPL", portfolioId)).thenReturn(report);
        when(chatMessageRepository.save(any(ChatMessage.class)))
                .thenAnswer(inv -> inv.getArgument(0));

        RiskReport result = service.assess("Analyze AAPL", portfolioId, userId, sessionId);

        assertThat(result.riskScore()).isEqualTo(65);
        assertThat(result.riskLevel()).isEqualTo("HIGH");

        ArgumentCaptor<ChatMessage> captor = ArgumentCaptor.forClass(ChatMessage.class);
        verify(chatMessageRepository, times(2)).save(captor.capture());
        assertThat(captor.getAllValues().get(0).getRole()).isEqualTo("user");
        assertThat(captor.getAllValues().get(1).getRole()).isEqualTo("assistant");
    }

    @Test
    void getSessionHistory_shouldReturnOrderedMessages() {
        ChatMessage msg1 = ChatMessage.builder()
                .sessionId(sessionId).role("user").content("Q").build();
        ChatMessage msg2 = ChatMessage.builder()
                .sessionId(sessionId).role("assistant").content("A").build();
        when(chatMessageRepository.findBySessionIdOrderByCreatedAtAsc(sessionId))
                .thenReturn(List.of(msg1, msg2));

        List<ChatMessage> history = service.getSessionHistory(sessionId);

        assertThat(history).hasSize(2);
        assertThat(history.get(0).getRole()).isEqualTo("user");
        assertThat(history.get(1).getRole()).isEqualTo("assistant");
    }
}
