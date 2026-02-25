package com.example.finsentinel.service.rag;

import com.example.finsentinel.config.RagRetrievalProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.ai.chat.model.ChatModel;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(MockitoExtension.class)
class QueryRewriteServiceTest {

    @Mock private ChatModel chatModel;
    private RagRetrievalProperties ragProps;
    private QueryRewriteService service;

    @BeforeEach
    void setUp() {
        ragProps = new RagRetrievalProperties();
        service = new QueryRewriteService(chatModel, ragProps);
    }

    @Test
    void rewrite_whenDisabled_shouldReturnOriginal() {
        ragProps.setQueryRewriteEnabled(false);
        assertThat(service.rewrite("AAPL risk?")).isEqualTo("AAPL risk?");
    }

    @Test
    void rewrite_whenQueryExceedsMaxLength_shouldReturnOriginal() {
        ragProps.setQueryRewriteMaxLength(10);
        String longQuery = "What is the investment risk for Apple Inc AAPL stock including volatility";
        assertThat(service.rewrite(longQuery)).isEqualTo(longQuery);
    }

    @Test
    void rewrite_whenNull_shouldReturnNull() {
        assertThat(service.rewrite(null)).isNull();
    }

    @Test
    void rewrite_whenBlank_shouldReturnBlank() {
        assertThat(service.rewrite("  ")).isEqualTo("  ");
    }
}
