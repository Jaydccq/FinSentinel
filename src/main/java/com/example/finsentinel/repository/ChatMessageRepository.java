package com.example.finsentinel.repository;

import com.example.finsentinel.model.ChatMessage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * Declares persistence operations for chat message repository data.
 *
 * <p>This interface is part of the repository layer in FinSentinel.
 */

public interface ChatMessageRepository extends JpaRepository<ChatMessage, UUID> {


    List<ChatMessage> findBySessionIdOrderByCreatedAtAsc(UUID sessionId);

    List<ChatMessage> findBySessionIdAndUserIdOrderByCreatedAtAsc(UUID sessionId, UUID userId);


    List<ChatMessage> findByUserIdOrderByCreatedAtDesc(UUID userId);
}
