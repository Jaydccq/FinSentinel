package com.example.finsentinel.service.storage;

import com.example.finsentinel.config.GoogleDriveProperties;
import com.google.api.client.http.InputStreamContent;
import com.google.api.services.drive.Drive;
import com.google.api.services.drive.model.File;
import com.google.api.services.drive.model.FileList;
import lombok.extern.slf4j.Slf4j;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.List;

/**
 * Google Drive implementation of {@link StorageService}.
 * Uses folder-based hierarchy mirroring the object key path structure.
 * Folders are created on-demand.
 */
@Slf4j
public class GoogleDriveStorageService implements StorageService {

    private static final String FOLDER_MIME = "application/vnd.google-apps.folder";

    private final Drive drive;
    private final GoogleDriveProperties properties;

    public GoogleDriveStorageService(Drive drive, GoogleDriveProperties properties) {
        this.drive = drive;
        this.properties = properties;
    }

    @Override
    public void upload(String key, byte[] content, String contentType) {
        try {
            String[] parts = key.split("/");
            String fileName = parts[parts.length - 1];

            String parentFolderId = properties.getRootFolderId();
            for (int i = 0; i < parts.length - 1; i++) {
                parentFolderId = getOrCreateFolder(parts[i], parentFolderId);
            }

            File fileMetadata = new File();
            fileMetadata.setName(fileName);
            fileMetadata.setParents(Collections.singletonList(parentFolderId));

            InputStreamContent mediaContent = new InputStreamContent(
                    contentType, new ByteArrayInputStream(content));
            mediaContent.setLength(content.length);

            File uploaded = drive.files()
                    .create(fileMetadata, mediaContent)
                    .setSupportsAllDrives(true)
                    .setFields("id, name")
                    .execute();

            log.info("Uploaded {} ({} bytes) to Google Drive, fileId={}", key, content.length, uploaded.getId());
        } catch (IOException e) {
            throw new RuntimeException("Failed to upload " + key + " to Google Drive", e);
        }
    }

    @Override
    public byte[] download(String key) {
        try {
            String[] parts = key.split("/");
            String fileName = parts[parts.length - 1];

            String parentFolderId = properties.getRootFolderId();
            for (int i = 0; i < parts.length - 1; i++) {
                String folderId = findFolderId(parts[i], parentFolderId);
                if (folderId == null) {
                    throw new RuntimeException("Folder not found: " + parts[i] + " in path " + key);
                }
                parentFolderId = folderId;
            }

            String fileId = findFileId(fileName, parentFolderId);
            if (fileId == null) {
                throw new RuntimeException("File not found in Google Drive: " + key);
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            drive.files().get(fileId).setSupportsAllDrives(true).executeMediaAndDownloadTo(baos);
            return baos.toByteArray();
        } catch (IOException e) {
            throw new RuntimeException("Failed to download " + key + " from Google Drive", e);
        }
    }

    private String getOrCreateFolder(String folderName, String parentId) throws IOException {
        String existing = findFolderId(folderName, parentId);
        if (existing != null) {
            return existing;
        }

        File folderMetadata = new File();
        folderMetadata.setName(folderName);
        folderMetadata.setMimeType(FOLDER_MIME);
        folderMetadata.setParents(Collections.singletonList(parentId));

        File created = drive.files()
                .create(folderMetadata)
                .setSupportsAllDrives(true)
                .setFields("id")
                .execute();

        log.info("Created Google Drive folder: {} (id={})", folderName, created.getId());
        return created.getId();
    }

    private String findFolderId(String folderName, String parentId) throws IOException {
        FileList result = drive.files().list()
                .setQ(String.format(
                        "name='%s' and mimeType='%s' and '%s' in parents and trashed=false",
                        escapeSingleQuotes(folderName), FOLDER_MIME, parentId))
                .setSupportsAllDrives(true)
                .setIncludeItemsFromAllDrives(true)
                .setSpaces("drive")
                .setFields("files(id)")
                .setPageSize(1)
                .execute();

        List<File> files = result.getFiles();
        return (files != null && !files.isEmpty()) ? files.get(0).getId() : null;
    }

    private String findFileId(String fileName, String parentId) throws IOException {
        FileList result = drive.files().list()
                .setQ(String.format(
                        "name='%s' and '%s' in parents and trashed=false",
                        escapeSingleQuotes(fileName), parentId))
                .setSupportsAllDrives(true)
                .setIncludeItemsFromAllDrives(true)
                .setSpaces("drive")
                .setFields("files(id)")
                .setPageSize(1)
                .execute();

        List<File> files = result.getFiles();
        return (files != null && !files.isEmpty()) ? files.get(0).getId() : null;
    }

    private static String escapeSingleQuotes(String str) {
        return str.replace("'", "\\'");
    }
}
