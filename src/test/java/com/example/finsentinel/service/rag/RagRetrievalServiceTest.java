package com.example.finsentinel.service.rag;

import com.example.finsentinel.config.RagRetrievalProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class RagRetrievalServiceTest {

    @Mock private VectorStore vectorStore;

    private RagRetrievalProperties ragProps;
    private RagRetrievalService ragRetrievalService;

    @BeforeEach
    void setUp() {
        ragProps = new RagRetrievalProperties();
        ragRetrievalService = new RagRetrievalService(vectorStore, ragProps);
    }

    @Test
    void search_withAfterDate_shouldIncludeDateFilter() {
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of());

        ragRetrievalService.search("test query", 8, "NEWS", null, null, "2026-01-01");

        ArgumentCaptor<SearchRequest> captor = ArgumentCaptor.forClass(SearchRequest.class);
        verify(vectorStore).similaritySearch(captor.capture());
        String filterExpr = captor.getValue().getFilterExpression().toString();
        assertThat(filterExpr).contains("doc_type");
        assertThat(filterExpr).contains("date");
    }

    @Test
    void search_withoutAfterDate_shouldNotIncludeDateFilter() {
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of());

        ragRetrievalService.search("test query", 5, null, null, null, null);

        ArgumentCaptor<SearchRequest> captor = ArgumentCaptor.forClass(SearchRequest.class);
        verify(vectorStore).similaritySearch(captor.capture());
        // No filters at all when everything is null
        assertThat(captor.getValue().getFilterExpression()).isNull();
    }

    @Test
    void search_fiveParamOverload_shouldDelegateToSixParam() {
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of());

        ragRetrievalService.search("test query", 5, "SEC_FILING", null, null);

        ArgumentCaptor<SearchRequest> captor = ArgumentCaptor.forClass(SearchRequest.class);
        verify(vectorStore).similaritySearch(captor.capture());
        String filterExpr = captor.getValue().getFilterExpression().toString();
        assertThat(filterExpr).contains("doc_type");
        assertThat(filterExpr).doesNotContain("date");
    }

    @Test
    void search_shouldCapTopKAtMax() {
        ragProps.setMaxTopK(10);
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of());

        ragRetrievalService.search("analyze AAPL earnings report risk", 50, null, null, null);

        ArgumentCaptor<SearchRequest> captor = ArgumentCaptor.forClass(SearchRequest.class);
        verify(vectorStore).similaritySearch(captor.capture());
        assertThat(captor.getValue().getTopK()).isEqualTo(10);
    }

    @Test
    void search_nullQuery_shouldReturnEmptyList() {
        assertThat(ragRetrievalService.search(null, 5, null, null, null)).isEmpty();
        verifyNoInteractions(vectorStore);
    }

    @Test
    void search_blankQuery_shouldReturnEmptyList() {
        assertThat(ragRetrievalService.search("  ", 5, null, null, null)).isEmpty();
        verifyNoInteractions(vectorStore);
    }
}
