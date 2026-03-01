package com.example.finsentinel.agent;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.ai.chat.client.ChatClient;
import reactor.core.publisher.Flux;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link StockAnalysisService}.
 * Verifies the ChatClient fluent API delegation without Spring context.
 */
@ExtendWith(MockitoExtension.class)
class StockAnalysisServiceTest {

    @Mock private ChatClient stockAnalysisChatClient;
    @Mock private ChatClient.ChatClientRequestSpec requestSpec;
    @Mock private ChatClient.StreamResponseSpec streamResponseSpec;

    private StockAnalysisService service;

    @BeforeEach
    void setUp() {
        service = new StockAnalysisService(stockAnalysisChatClient);
    }

    @Test
    void analyzeStream_shouldReturnFluxFromChatClient() {
        // Arrange: wire the fluent ChatClient chain
        when(stockAnalysisChatClient.prompt()).thenReturn(requestSpec);
        when(requestSpec.user(anyString())).thenReturn(requestSpec);
        when(requestSpec.stream()).thenReturn(streamResponseSpec);
        when(streamResponseSpec.content()).thenReturn(Flux.just("AAPL is ", "trading at ", "$180."));

        // Act
        List<String> chunks = service.analyzeStream("Analyze AAPL stock").collectList().block();

        // Assert
        assertThat(chunks).containsExactly("AAPL is ", "trading at ", "$180.");
        verify(stockAnalysisChatClient).prompt();
        verify(requestSpec).user("Analyze AAPL stock");
        verify(requestSpec).stream();
        verify(streamResponseSpec).content();
    }

    @Test
    void analyzeStream_shouldPassPromptTextVerbatim() {
        String longPrompt = "You are a stock analyst. Analyze TSLA with RSI, MACD, Bollinger Bands.";

        when(stockAnalysisChatClient.prompt()).thenReturn(requestSpec);
        when(requestSpec.user(anyString())).thenReturn(requestSpec);
        when(requestSpec.stream()).thenReturn(streamResponseSpec);
        when(streamResponseSpec.content()).thenReturn(Flux.just("Analysis complete."));

        service.analyzeStream(longPrompt).collectList().block();

        // Verify the exact prompt text is forwarded to ChatClient
        verify(requestSpec).user(longPrompt);
    }

    @Test
    void analyzeStream_shouldPropagateEmptyFlux() {
        when(stockAnalysisChatClient.prompt()).thenReturn(requestSpec);
        when(requestSpec.user(anyString())).thenReturn(requestSpec);
        when(requestSpec.stream()).thenReturn(streamResponseSpec);
        when(streamResponseSpec.content()).thenReturn(Flux.empty());

        List<String> chunks = service.analyzeStream("Analyze XYZ").collectList().block();

        assertThat(chunks).isEmpty();
    }

    @Test
    void analyzeStream_shouldPropagateErrorFromChatClient() {
        when(stockAnalysisChatClient.prompt()).thenReturn(requestSpec);
        when(requestSpec.user(anyString())).thenReturn(requestSpec);
        when(requestSpec.stream()).thenReturn(streamResponseSpec);
        when(streamResponseSpec.content())
                .thenReturn(Flux.error(new RuntimeException("LLM timeout")));

        Flux<String> result = service.analyzeStream("Analyze FAIL");

        // Verify the error propagates through the Flux
        List<String> collected = null;
        RuntimeException thrown = null;
        try {
            collected = result.collectList().block();
        } catch (RuntimeException e) {
            thrown = e;
        }

        assertThat(thrown).isNotNull();
        assertThat(thrown.getMessage()).contains("LLM timeout");
    }
}