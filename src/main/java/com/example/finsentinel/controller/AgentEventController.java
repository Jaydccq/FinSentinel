package com.example.finsentinel.controller;

import com.example.finsentinel.dto.event.AgentEventResponse;
import com.example.finsentinel.model.User;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.event.AgentEventService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Read-only event timeline/replay endpoints.
 */
@RestController
@RequestMapping("/api/events")
@RequiredArgsConstructor
public class AgentEventController {

    private final AgentEventService agentEventService;
    private final UserRepository userRepository;

    /**
     * Returns recent events (descending by sequence) or replay from a cursor sequence (ascending).
     *
     * <p>If {@code afterSeq} is provided, returns events with seq_no > afterSeq in ascending order.
     * Otherwise returns recent events in descending order.
     */
    @GetMapping
    public ResponseEntity<List<AgentEventResponse>> listEvents(
            @RequestParam(required = false) Long afterSeq,
            @RequestParam(defaultValue = "50") Integer limit,
            @AuthenticationPrincipal UserDetails userDetails) {
        User user = resolveUser(userDetails);

        var events = afterSeq == null
                ? agentEventService.getRecent(user.getId(), limit)
                : agentEventService.replayAfter(user.getId(), afterSeq, limit);

        return ResponseEntity.ok(events.stream().map(e -> new AgentEventResponse(
                e.getId(),
                e.getSeqNo(),
                e.getUserId(),
                e.getAggregateType().name(),
                e.getAggregateId(),
                e.getEventType().name(),
                e.getPayloadJson(),
                e.getCreatedAt()
        )).toList());
    }

    private User resolveUser(UserDetails userDetails) {
        return userRepository.findByUsername(userDetails.getUsername())
                .orElseThrow(() -> new IllegalStateException("User not found"));
    }
}
