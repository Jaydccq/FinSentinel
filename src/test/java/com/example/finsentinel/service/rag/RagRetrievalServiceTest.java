package com.example.finsentinel.service.rag;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
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
    @InjectMocks private RagRetrievalService ragRetrievalService;

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
}
