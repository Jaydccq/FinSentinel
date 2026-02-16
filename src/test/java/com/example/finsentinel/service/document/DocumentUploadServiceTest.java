package com.example.finsentinel.service.document;

import com.example.finsentinel.dto.document.DocumentUploadResponse;
import com.example.finsentinel.model.Document;
import com.example.finsentinel.model.enums.DocumentStatus;
import com.example.finsentinel.model.enums.DocumentType;
import com.example.finsentinel.repository.DocumentRepository;
import com.example.finsentinel.service.storage.MinioStorageService;
import com.example.finsentinel.stream.VectorizeStreamProducer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

import java.time.LocalDateTime;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class DocumentUploadServiceTest {

    @Mock
    private DocumentParseService documentParseService;

    @Mock
    private VectorizeStreamProducer vectorizeStreamProducer;

    @Mock
    private MinioStorageService minioStorageService;

    @Mock
    private DocumentRepository documentRepository;

    @InjectMocks
    private DocumentUploadService documentUploadService;

    @Test
    void upload_validFile_shouldReturnPendingAndQueueTask() {
        String content = "This is a test document about financial risk assessment. ".repeat(50);
        MockMultipartFile file = new MockMultipartFile(
                "file", "test-report.pdf", "application/pdf", content.getBytes());

        UUID docId = UUID.randomUUID();

        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> {
            Document doc = invocation.getArgument(0);
            if (doc.getId() == null) {
                doc.setId(docId);
            }
            return doc;
        });

        when(documentParseService.parseToCleanText(any(byte[].class), eq("test-report.pdf")))
                .thenReturn(content);

        DocumentUploadResponse response = documentUploadService.upload(
                file, DocumentType.RESEARCH_REPORT, "technology", "US");

        assertNotNull(response);
        assertEquals("test-report.pdf", response.fileName());
        assertEquals(DocumentType.RESEARCH_REPORT, response.docType());
        assertEquals(DocumentStatus.PENDING, response.status());
        assertEquals("technology", response.sector());
        assertEquals("US", response.regionId());

        verify(minioStorageService).upload(anyString(), any(byte[].class), eq("application/pdf"));
        verify(documentParseService).parseToCleanText(any(byte[].class), eq("test-report.pdf"));
        verify(vectorizeStreamProducer).send(any(UUID.class));
    }

    @Test
    void upload_emptyFile_shouldThrowIllegalArgument() {
        MockMultipartFile file = new MockMultipartFile(
                "file", "empty.txt", "text/plain", new byte[0]);

        assertThrows(IllegalArgumentException.class, () ->
                documentUploadService.upload(file, DocumentType.OTHER, null, "US"));

        verifyNoInteractions(documentParseService, vectorizeStreamProducer, minioStorageService);
    }

    @Test
    void upload_parseFailure_shouldSetStatusFailed() {
        String content = "Some content";
        MockMultipartFile file = new MockMultipartFile(
                "file", "bad-file.pdf", "application/pdf", content.getBytes());

        when(documentRepository.save(any(Document.class))).thenAnswer(invocation -> {
            Document doc = invocation.getArgument(0);
            if (doc.getId() == null) {
                doc.setId(UUID.randomUUID());
            }
            return doc;
        });

        when(documentParseService.parseToCleanText(any(byte[].class), eq("bad-file.pdf")))
                .thenThrow(new IllegalArgumentException("Parse error"));

        assertThrows(RuntimeException.class, () ->
                documentUploadService.upload(file, DocumentType.SEC_FILING, null, "US"));

        verify(vectorizeStreamProducer, never()).send(any(UUID.class));
    }
}
