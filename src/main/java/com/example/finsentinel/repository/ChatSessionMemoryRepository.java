package com.example.finsentinel.repository;

import com.example.finsentinel.model.ChatSessionMemory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * Persistence operations for chat context compaction snapshots.
 */
public interface ChatSessionMemoryRepository extends JpaRepository<ChatSessionMemory, UUID> {

    Optional<ChatSessionMemory> findByUserIdAndSessionId(UUID userId, UUID sessionId);
}
