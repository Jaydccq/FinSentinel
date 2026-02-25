package com.example.finsentinel.controller;

import com.example.finsentinel.dto.autonomy.AgentScheduleRequest;
import com.example.finsentinel.dto.autonomy.AgentScheduleResponse;
import com.example.finsentinel.model.User;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.autonomy.AgentScheduleService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * APIs for user-managed autonomous cron schedules.
 */
@RestController
@RequestMapping("/api/schedules")
@RequiredArgsConstructor
public class AgentScheduleController {

    private final AgentScheduleService scheduleService;
    private final UserRepository userRepository;

    @GetMapping
    public ResponseEntity<List<AgentScheduleResponse>> list(@AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        return ResponseEntity.ok(scheduleService.listByUser(user.getId()).stream()
                .map(this::toResponse)
                .toList());
    }

    @PostMapping
    public ResponseEntity<AgentScheduleResponse> create(@Valid @RequestBody AgentScheduleRequest request,
                                                        @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        var saved = scheduleService.create(
                user.getId(),
                request.name(),
                request.cronExpression(),
                request.taskType(),
                request.payload(),
                request.enabled()
        );
        return ResponseEntity.ok(toResponse(saved));
    }

    @PutMapping("/{id}")
    public ResponseEntity<AgentScheduleResponse> update(@PathVariable UUID id,
                                                        @Valid @RequestBody AgentScheduleRequest request,
                                                        @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        var saved = scheduleService.update(
                user.getId(),
                id,
                request.name(),
                request.cronExpression(),
                request.taskType(),
                request.payload(),
                request.enabled()
        );
        return ResponseEntity.ok(toResponse(saved));
    }

    @PostMapping("/{id}/pause")
    public ResponseEntity<AgentScheduleResponse> pause(@PathVariable UUID id,
                                                       @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        return ResponseEntity.ok(toResponse(scheduleService.setEnabled(user.getId(), id, false)));
    }

    @PostMapping("/{id}/resume")
    public ResponseEntity<AgentScheduleResponse> resume(@PathVariable UUID id,
                                                        @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        return ResponseEntity.ok(toResponse(scheduleService.setEnabled(user.getId(), id, true)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id,
                                       @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);
        scheduleService.delete(user.getId(), id);
        return ResponseEntity.noContent().build();
    }

    private User resolveUser(UserDetails userDetails) {
        return userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new IllegalStateException("User not found"));
    }

    private AgentScheduleResponse toResponse(com.example.finsentinel.model.AgentSchedule s) {
        return new AgentScheduleResponse(
                s.getId(),
                s.getName(),
                s.getCronExpression(),
                s.getTaskType().name(),
                s.getTaskPayload(),
                s.isEnabled(),
                s.getLastRunAt(),
                s.getNextRunAt(),
                s.getCreatedAt(),
                s.getUpdatedAt()
        );
    }
}
