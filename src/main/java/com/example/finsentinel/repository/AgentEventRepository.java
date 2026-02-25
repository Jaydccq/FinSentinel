package com.example.finsentinel.repository;

import com.example.finsentinel.model.AgentEvent;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Persistence operations for typed append-only agent events.
 */
public interface AgentEventRepository extends JpaRepository<AgentEvent, UUID> {

    Optional<AgentEvent> findByUserIdAndIdempotencyKey(UUID userId, String idempotencyKey);

    List<AgentEvent> findByUserIdOrderBySeqNoDesc(UUID userId, Pageable pageable);

    List<AgentEvent> findByUserIdAndSeqNoGreaterThanOrderBySeqNoAsc(UUID userId, Long afterSeqNo, Pageable pageable);
}
