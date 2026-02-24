package com.example.finsentinel.repository;

import com.example.finsentinel.model.AgentBrain;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * Persistence operations for agent brain cognitive state.
 *
 * <p>This interface is part of the repository layer in FinSentinel.
 */
public interface AgentBrainRepository extends JpaRepository<AgentBrain, UUID> {

    Optional<AgentBrain> findByUserId(UUID userId);
}
