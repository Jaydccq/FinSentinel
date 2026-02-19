package com.example.finsentinel.service.storage;

import com.example.finsentinel.config.GoogleDriveProperties;
import com.google.api.services.drive.Drive;
import com.google.api.services.drive.Drive.Files;
import com.google.api.services.drive.Drive.Files.Create;
import com.google.api.services.drive.Drive.Files.Get;
import com.google.api.services.drive.model.File;
import com.google.api.services.drive.model.FileList;
import com.google.api.client.http.InputStreamContent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.ByteArrayOutputStream;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class GoogleDriveStorageServiceTest {

    @Mock private Drive drive;
    @Mock private Files files;
    @Mock private Create createRequest;
    @Mock private Get getRequest;
    @Mock private Drive.Files.List listRequest;

    private GoogleDriveProperties properties;
    private GoogleDriveStorageService service;

    @BeforeEach
    void setUp() {
        properties = new GoogleDriveProperties();
        properties.setRootFolderId("root-folder-id");
        properties.setApplicationName("FinSentinel-Test");

        lenient().when(drive.files()).thenReturn(files);
        service = new GoogleDriveStorageService(drive, properties);
    }

    @Test
    void implementsStorageServiceInterface() {
        assertThat(service).isInstanceOf(StorageService.class);
    }

    @Test
    void uploadCreatesFileInCorrectFolder() throws Exception {
        byte[] content = "test content".getBytes();
        String key = "sec-filings/AAPL/doc123.pdf";
        File createdFile = new File();
        createdFile.setId("drive-file-id-123");

        when(files.list()).thenReturn(listRequest);
        when(listRequest.setQ(anyString())).thenReturn(listRequest);
        when(listRequest.setSpaces(anyString())).thenReturn(listRequest);
        when(listRequest.setFields(anyString())).thenReturn(listRequest);
        when(listRequest.setPageSize(anyInt())).thenReturn(listRequest);

        FileList emptyList = new FileList();
        emptyList.setFiles(Collections.emptyList());
        when(listRequest.execute()).thenReturn(emptyList);

        Drive.Files.Create folderCreate = mock(Drive.Files.Create.class);
        when(files.create(any(File.class))).thenReturn(folderCreate);
        when(folderCreate.setFields(anyString())).thenReturn(folderCreate);
        File createdFolder = new File();
        createdFolder.setId("created-folder-id");
        when(folderCreate.execute()).thenReturn(createdFolder);

        when(files.create(any(File.class), any(InputStreamContent.class))).thenReturn(createRequest);
        when(createRequest.setFields(anyString())).thenReturn(createRequest);
        when(createRequest.execute()).thenReturn(createdFile);

        service.upload(key, content, "application/pdf");

        verify(files).create(any(File.class), any(InputStreamContent.class));
    }

    @Test
    void downloadReturnsFileBytes() throws Exception {
        String key = "sec-filings/AAPL/doc123.pdf";
        byte[] expectedBytes = "downloaded content".getBytes();

        when(files.list()).thenReturn(listRequest);
        when(listRequest.setQ(anyString())).thenReturn(listRequest);
        when(listRequest.setSpaces(anyString())).thenReturn(listRequest);
        when(listRequest.setFields(anyString())).thenReturn(listRequest);
        when(listRequest.setPageSize(anyInt())).thenReturn(listRequest);
        File foundFile = new File();
        foundFile.setId("drive-file-id-123");
        foundFile.setName("doc123.pdf");
        FileList fileList = new FileList();
        fileList.setFiles(List.of(foundFile));
        when(listRequest.execute()).thenReturn(fileList);

        when(files.get("drive-file-id-123")).thenReturn(getRequest);
        doAnswer(invocation -> {
            ByteArrayOutputStream out = invocation.getArgument(0);
            out.write(expectedBytes);
            return null;
        }).when(getRequest).executeMediaAndDownloadTo(any(java.io.OutputStream.class));

        byte[] result = service.download(key);

        assertThat(result).isEqualTo(expectedBytes);
    }
}
