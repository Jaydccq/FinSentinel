package com.example.finsentinel.controller;

import com.example.finsentinel.dto.autonomy.HeartbeatConfigRequest;
import com.example.finsentinel.dto.autonomy.HeartbeatConfigResponse;
import com.example.finsentinel.model.User;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.autonomy.AgentHeartbeatService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * APIs for per-user heartbeat autonomous wake-up configuration.
 */
@RestController
@RequestMapping("/api/heartbeat")
@RequiredArgsConstructor
public class HeartbeatController {

    private final AgentHeartbeatService heartbeatService;
    private final UserRepository userRepository;

    @GetMapping
    public ResponseEntity<HeartbeatConfigResponse> get(@AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        return ResponseEntity.ok(toResponse(heartbeatService.getOrCreateConfig(user.getId())));
    }

    @PutMapping
    public ResponseEntity<HeartbeatConfigResponse> update(
            @Valid @RequestBody HeartbeatConfigRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        return ResponseEntity.ok(toResponse(heartbeatService.updateConfig(
                user.getId(),
                request.enabled(),
                request.intervalSeconds(),
                request.drawdownAlertPct()
        )));
    }

    private User resolveUser(UserDetails userDetails) {
        return userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new IllegalStateException("User not found"));
    }

    private HeartbeatConfigResponse toResponse(com.example.finsentinel.model.AgentHeartbeatConfig cfg) {
        return new HeartbeatConfigResponse(
                cfg.isEnabled(),
                cfg.getIntervalSeconds(),
                cfg.getDrawdownAlertPct(),
                cfg.getLastBeatAt(),
                cfg.getUpdatedAt()
        );
    }
}
