package com.example.finsentinel.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * Persists an encrypted API key for a user.
 *
 * <p>Each user may store multiple keys identified by {@code keyName}
 * (e.g. POLYGON_API_KEY, OKX_API_KEY). The raw value is never stored;
 * only the AES-256-GCM ciphertext and its IV are persisted.
 *
 * <p>This class belongs to the model layer in FinSentinel.
 */
@Entity
@Table(name = "api_keys")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApiKeyEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "key_name", nullable = false, length = 64)
    private String keyName;

    @Column(name = "encrypted_value", nullable = false, columnDefinition = "TEXT")
    private String encryptedValue;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String iv;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        createdAt = updatedAt = Instant.now();
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
