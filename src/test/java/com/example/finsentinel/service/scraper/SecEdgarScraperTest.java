package com.example.finsentinel.service.scraper;

import com.example.finsentinel.model.Document;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.service.storage.StorageService;
import com.example.finsentinel.stream.VectorizeStreamProducer;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Implements sec edgar scraper test business operations and integrations.
 *
 * <p>This class belongs to the service layer in FinSentinel.
 */

@ExtendWith(MockitoExtension.class)
class SecEdgarScraperTest {

    @Mock private FirecrawlClient firecrawlClient;
    @Mock private StorageService storageService;
    @Mock private DocumentRepository documentRepository;
    @Mock private RestClient restClient;
    @Mock private VectorizeStreamProducer vectorizeStreamProducer;
    @Mock private RestClient.RequestHeadersUriSpec requestHeadersUriSpec;
    @Mock private RestClient.RequestHeadersSpec requestHeadersSpec;
    @Mock private RestClient.ResponseSpec responseSpec;

    private SecEdgarScraper scraper;
    private ObjectMapper objectMapper = new ObjectMapper();


    @BeforeEach
    void setUp() {
        scraper = new SecEdgarScraper(firecrawlClient, storageService, documentRepository, restClient, vectorizeStreamProducer);
    }


    @Test
    void scrape_shouldCallVectorizeStreamProducerAfterSave() throws Exception {
        // Mock EDGAR search returning one filing URL
        String searchResponse = """
            {"hits":{"hits":[{"_source":{"file_url":"/test/filing.htm"}}]}}
            """;
        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.header(anyString(), anyString())).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(JsonNode.class)).thenReturn(objectMapper.readTree(searchResponse));

        // Mock Firecrawl returning content
        when(firecrawlClient.scrape(anyString()))
                .thenReturn(new FirecrawlClient.ScrapeResult("Test Filing", "# Filing Content", "https://sec.gov/test"));

        // Mock dedup check
        when(documentRepository.existsByOriginalFileName(anyString())).thenReturn(false);

        // Mock save to return document with UUID
        UUID docId = UUID.randomUUID();
        when(documentRepository.save(any(Document.class))).thenAnswer(inv -> {
            Document doc = inv.getArgument(0);
            doc.setId(docId);
            return doc;
        });

        int result = scraper.scrape(List.of("AAPL"));

        assertThat(result).isEqualTo(1);
        verify(vectorizeStreamProducer).send(docId);
    }


    @Test
    void scrape_shouldSkipDuplicateDocuments() throws Exception {
        String searchResponse = """
            {"hits":{"hits":[{"_source":{"file_url":"/test/filing.htm"}}]}}
            """;
        when(restClient.get()).thenReturn(requestHeadersUriSpec);
        when(requestHeadersUriSpec.uri(anyString(), any(Object[].class))).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.header(anyString(), anyString())).thenReturn(requestHeadersSpec);
        when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
        when(responseSpec.body(JsonNode.class)).thenReturn(objectMapper.readTree(searchResponse));

        when(firecrawlClient.scrape(anyString()))
                .thenReturn(new FirecrawlClient.ScrapeResult("Test Filing", "# Content", "https://sec.gov/test"));

        // Dedup: document already exists
        when(documentRepository.existsByOriginalFileName("Test Filing")).thenReturn(true);

        int result = scraper.scrape(List.of("AAPL"));

        assertThat(result).isEqualTo(0);
        verify(documentRepository, never()).save(any());
        verify(vectorizeStreamProducer, never()).send(any());
    }
}
