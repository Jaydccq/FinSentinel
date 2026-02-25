package com.example.finsentinel.repository;

import com.example.finsentinel.model.AgentSchedule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Persistence operations for autonomous cron schedules.
 */
public interface AgentScheduleRepository extends JpaRepository<AgentSchedule, UUID> {

    List<AgentSchedule> findByEnabledTrue();

    List<AgentSchedule> findByUserIdOrderByCreatedAtDesc(UUID userId);

    Optional<AgentSchedule> findByIdAndUserId(UUID id, UUID userId);

    long countByUserId(UUID userId);
}
