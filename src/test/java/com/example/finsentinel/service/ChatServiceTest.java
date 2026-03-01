package com.example.finsentinel.service;

import com.example.finsentinel.agent.RiskAgentService;
import com.example.finsentinel.agent.StockAnalysisService;
import com.example.finsentinel.dto.risk.ComplianceNote;
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.model.ChatMessage;
import com.example.finsentinel.repository.PortfolioRepository;
import com.example.finsentinel.repository.ChatMessageRepository;
import com.example.finsentinel.service.chat.ChatContextCompactionService;
import com.example.finsentinel.service.event.AgentEventService;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Implements chat service test business operations and integrations.
 *
 * <p>This class belongs to the service layer in FinSentinel.
 */

@ExtendWith(MockitoExtension.class)
class ChatServiceTest {

    @Mock private RiskAgentService riskAgentService;
    @Mock private ChatMessageRepository chatMessageRepository;
    @Mock private PortfolioRepository portfolioRepository;
    @Mock private AgentEventService agentEventService;
    @Mock private ChatContextCompactionService chatContextCompactionService;
    @Mock private StockAnalysisService stockAnalysisService;

    private ChatService service;

    private final UUID userId = UUID.randomUUID();
    private final UUID portfolioId = UUID.randomUUID();
    private final UUID sessionId = UUID.randomUUID();


    @BeforeEach
    void setUp() {
        service = new ChatService(riskAgentService, chatMessageRepository, portfolioRepository,
                agentEventService, chatContextCompactionService, stockAnalysisService);
        lenient().when(chatContextCompactionService.augmentPrompt(any(), any(), any()))
                .thenAnswer(inv -> inv.getArgument(2));
    }


    @Test
    void streamChat_shouldPersistUserMessageAndSubscribeToFlux() {
        when(portfolioRepository.existsByIdAndUserId(portfolioId, userId)).thenReturn(true);
        when(chatMessageRepository.save(any(ChatMessage.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(riskAgentService.assessStream("Test question", portfolioId, userId))
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
        when(portfolioRepository.existsByIdAndUserId(portfolioId, userId)).thenReturn(true);
        when(chatMessageRepository.save(any(ChatMessage.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        when(riskAgentService.assessStream("Test", portfolioId, userId))
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
        when(portfolioRepository.existsByIdAndUserId(portfolioId, userId)).thenReturn(true);
        RiskReport report = new RiskReport(
                65, "HIGH", "Test risk", List.of(), List.of(),
                new ComplianceNote("Disclaimer", "SEC", true));
        when(riskAgentService.assess("Analyze AAPL", portfolioId, userId)).thenReturn(report);
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
    void assess_shouldThrowWhenPortfolioNotOwnedByUser() {
        when(portfolioRepository.existsByIdAndUserId(portfolioId, userId)).thenReturn(false);

        assertThatThrownBy(() -> service.assess("Analyze AAPL", portfolioId, userId, sessionId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Portfolio not found");

        verify(riskAgentService, never()).assess(any(), any(), any());
    }

    @Test
    void streamChat_shouldThrowWhenPortfolioNotOwnedByUser() {
        when(portfolioRepository.existsByIdAndUserId(portfolioId, userId)).thenReturn(false);

        assertThatThrownBy(() -> service.streamChat(
                "Test question",
                sessionId,
                portfolioId,
                userId,
                new SseEmitter(120_000L)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Portfolio not found");

        verify(riskAgentService, never()).assessStream(any(), any(), any());
    }


    @Test
    void getSessionHistory_shouldReturnOrderedMessagesForUser() {
        ChatMessage msg1 = ChatMessage.builder()
                .sessionId(sessionId).userId(userId).role("user").content("Q").build();
        ChatMessage msg2 = ChatMessage.builder()
                .sessionId(sessionId).userId(userId).role("assistant").content("A").build();
        when(chatMessageRepository.findTop100BySessionIdAndUserIdOrderByCreatedAtAsc(sessionId, userId))
                .thenReturn(List.of(msg1, msg2));

        List<ChatMessage> history = service.getSessionHistory(sessionId, userId);

        assertThat(history).hasSize(2);
        assertThat(history.get(0).getRole()).isEqualTo("user");
        assertThat(history.get(1).getRole()).isEqualTo("assistant");
    }

    @Test
    void streamAnalysis_truncatesWhenExceedingMaxChars() throws Exception {
        String hugeChunk = "x".repeat(60_000);
        when(stockAnalysisService.analyzeStream(any()))
                .thenReturn(Flux.just(hugeChunk));

        SseEmitter emitter = mock(SseEmitter.class);
        service.streamAnalysis("Analyze AAPL", userId, emitter);

        // Allow async subscriber to execute
        Thread.sleep(200);

        // Verify emitter was completed (not left hanging)
        verify(emitter, atLeastOnce()).complete();
    }
}
