package com.example.finsentinel.repository;

import com.example.finsentinel.model.ApiKeyEntry;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Persistence operations for encrypted API key entries.
 *
 * <p>This interface is part of the repository layer in FinSentinel.
 */
public interface ApiKeyRepository extends JpaRepository<ApiKeyEntry, UUID> {

    List<ApiKeyEntry> findByUserId(UUID userId);

    Optional<ApiKeyEntry> findByUserIdAndKeyName(UUID userId, String keyName);

    void deleteByUserIdAndKeyName(UUID userId, String keyName);
}
