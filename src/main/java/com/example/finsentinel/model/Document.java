package com.example.finsentinel.model;

import com.example.finsentinel.model.enums.DocumentStatus;
import com.example.finsentinel.model.enums.DocumentType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "documents")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Document {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String fileName;

    @Column(nullable = false)
    private String originalFileName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private DocumentType docType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private DocumentStatus status = DocumentStatus.PENDING;

    private String sector;

    @Column(length = 10)
    @Builder.Default
    private String regionId = "US";

    private Long fileSize;

    private Integer chunkCount;

    private String storageKey;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;
}
