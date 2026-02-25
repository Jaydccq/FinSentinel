package com.example.finsentinel.repository;

import com.example.finsentinel.model.AgentHeartbeatConfig;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/**
 * Persistence operations for per-user heartbeat settings.
 */
public interface AgentHeartbeatConfigRepository extends JpaRepository<AgentHeartbeatConfig, UUID> {

    List<AgentHeartbeatConfig> findByEnabledTrue();
}
