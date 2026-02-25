package com.example.finsentinel.service.autonomy;

import com.example.finsentinel.config.AutonomyProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Periodic dispatcher that wakes due user heartbeat checks.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class HeartbeatDispatcher {

    private final AgentHeartbeatService heartbeatService;
    private final AutonomyProperties autonomyProperties;

    @Scheduled(fixedDelayString = "${app.autonomy.heartbeat.dispatcher-interval-ms:30000}")
    public void dispatch() {
        if (!autonomyProperties.getHeartbeat().isEnabled()) {
            return;
        }
        try {
            heartbeatService.dispatchDueHeartbeats();
        } catch (Exception e) {
            log.warn("Heartbeat dispatch failed: {}", e.getMessage());
        }
    }
}
