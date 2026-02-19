package com.example.finsentinel.mapper;

import com.example.finsentinel.dto.document.DocumentUploadResponse;
import com.example.finsentinel.model.Document;
import org.mapstruct.Mapper;

/**
 * MapStruct mapper between {@link Document} entity and document DTOs.
 */
@Mapper(componentModel = "spring")
public interface DocumentMapper {

    DocumentUploadResponse toUploadResponse(Document document);
}
