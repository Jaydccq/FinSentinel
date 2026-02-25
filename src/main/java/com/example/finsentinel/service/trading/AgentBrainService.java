package com.example.finsentinel.service.trading;

import com.example.finsentinel.model.AgentBrain;
import com.example.finsentinel.model.User;
import com.example.finsentinel.model.enums.AgentEventAggregateType;
import com.example.finsentinel.model.enums.AgentEventType;
import com.example.finsentinel.repository.AgentBrainRepository;
import com.example.finsentinel.repository.UserRepository;
import com.example.finsentinel.service.event.AgentEventService;
import com.example.finsentinel.util.HashUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Service managing agent cognitive state using the OpenAlice Brain pattern.
 *
 * <p>Provides lazy-creation, read, and update operations for the AI trading
 * agent's persistent cognitive state. Every mutation (strategy update, emotion
 * change) is recorded as an immutable commit in the brain's JSONB commit history,
 * capped at 50 entries for bounded storage.
 *
 * <p>This class is part of the service layer in FinSentinel.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentBrainService {

    private static final int MAX_COMMIT_HISTORY = 50;
    private static final DateTimeFormatter TIMESTAMP_FMT = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    private final AgentBrainRepository brainRepository;
    private final UserRepository userRepository;
    private final AgentEventService agentEventService;

    /**
     * Retrieves or lazy-creates a brain for the given user.
     *
     * @param userId the user's UUID
     * @return the user's agent brain (never null)
     */
    @Transactional
    public AgentBrain getOrCreateBrain(UUID userId) {
        return brainRepository.findByUserId(userId)
                .orElseGet(() -> {
                    User user = userRepository.findById(userId)
                            .orElseThrow(() -> new IllegalArgumentException(
                                    "User not found: " + userId));
                    AgentBrain brain = AgentBrain.builder()
                            .user(user)
                            .build();
                    log.info("Creating new agent brain for user {}", userId);
                    return brainRepository.save(brain);
                });
    }

    /**
     * Updates the frontal lobe (trading strategy) and records a commit.
     *
     * @param userId  the user's UUID
     * @param content the new strategy content
     * @return confirmation message
     */
    @Transactional
    public String updateFrontalLobe(UUID userId, String content) {
        if (content == null) {
            return "Error: strategy content cannot be null";
        }
        AgentBrain brain = getOrCreateBrain(userId);
        String previousContent = brain.getFrontalLobe();
        brain.setFrontalLobe(content);
        addCommit(brain, "strategy", "Strategy updated");
        brainRepository.save(brain);
        String latestHash = extractLatestHash(brain);
        Map<String, Object> strategyPayload = new LinkedHashMap<>();
        strategyPayload.put("previousLength", previousContent != null ? previousContent.length() : 0);
        strategyPayload.put("newLength", content.length());
        strategyPayload.put("commitHash", latestHash != null ? latestHash : "");
        emitEvent(userId, brain.getId(), AgentEventType.BRAIN_STRATEGY_UPDATED,
                strategyPayload, latestHash == null ? null : "brain-strategy:" + latestHash);
        log.info("Updated frontal lobe for user {} (previous length: {}, new length: {})",
                userId, previousContent != null ? previousContent.length() : 0, content.length());
        return "Strategy updated successfully. Commit recorded.";
    }

    /**
     * Updates the agent's emotional state and records a commit.
     *
     * @param userId  the user's UUID
     * @param emotion the new emotion (e.g. neutral, confident, cautious, fearful, greedy)
     * @param reason  the reason for the emotional change
     * @return confirmation message
     */
    @Transactional
    public String updateEmotion(UUID userId, String emotion, String reason) {
        if (emotion == null || emotion.isBlank()) {
            return "Error: emotion cannot be blank";
        }
        AgentBrain brain = getOrCreateBrain(userId);
        String previousEmotion = brain.getEmotion();
        String normalizedEmotion = emotion.trim().toLowerCase(Locale.ROOT);
        brain.setEmotion(normalizedEmotion);
        addCommit(brain, "emotion", String.format("Emotion: %s -> %s. Reason: %s",
                previousEmotion, normalizedEmotion, reason));
        brainRepository.save(brain);
        String latestHash = extractLatestHash(brain);
        Map<String, Object> emotionPayload = new LinkedHashMap<>();
        emotionPayload.put("from", previousEmotion != null ? previousEmotion : "");
        emotionPayload.put("to", normalizedEmotion);
        emotionPayload.put("reason", reason != null ? reason : "");
        emotionPayload.put("commitHash", latestHash != null ? latestHash : "");
        emitEvent(userId, brain.getId(), AgentEventType.BRAIN_EMOTION_UPDATED,
                emotionPayload, latestHash == null ? null : "brain-emotion:" + latestHash);
        log.info("Updated emotion for user {} from '{}' to '{}'",
                userId, previousEmotion, normalizedEmotion);
        return String.format("Emotion updated from '%s' to '%s'. Reason: %s",
                previousEmotion, normalizedEmotion, reason);
    }

    /**
     * Reads the current frontal lobe (trading strategy).
     *
     * @param userId the user's UUID
     * @return the strategy content, or a default message if empty
     */
    @Transactional(readOnly = true)
    public String getFrontalLobe(UUID userId) {
        AgentBrain brain = getOrCreateBrain(userId);
        String content = brain.getFrontalLobe();
        if (content == null || content.isBlank()) {
            return "No strategy recorded yet. The agent has not formed any trading insights.";
        }
        return content;
    }

    /**
     * Reads the current emotional state.
     *
     * @param userId the user's UUID
     * @return the current emotion
     */
    @Transactional(readOnly = true)
    public String getEmotion(UUID userId) {
        AgentBrain brain = getOrCreateBrain(userId);
        return brain.getEmotion();
    }

    /**
     * Returns the last N commits from the brain's commit history,
     * formatted as a human-readable timeline (newest first).
     *
     * @param userId the user's UUID
     * @param limit  maximum number of commits to return (clamped to [1, 50])
     * @return formatted brain commit log
     */
    @Transactional(readOnly = true)
    public String getBrainLog(UUID userId, int limit) {
        AgentBrain brain = getOrCreateBrain(userId);
        List<Map<String, Object>> history = brain.getCommitHistory();

        if (history == null || history.isEmpty()) {
            return "No brain commits yet. The agent has not recorded any cognitive state changes.";
        }

        int clampedLimit = Math.min(Math.max(limit, 1), history.size());
        List<Map<String, Object>> recent = history.subList(
                history.size() - clampedLimit, history.size());

        StringBuilder sb = new StringBuilder();
        sb.append("=== Brain Commit Log ===\n\n");

        // Display in reverse chronological order (newest first)
        for (int i = recent.size() - 1; i >= 0; i--) {
            Map<String, Object> commit = recent.get(i);
            sb.append(String.format("commit %s\n", commit.get("hash")));
            sb.append(String.format("Type:    %s\n", commit.get("type")));
            sb.append(String.format("Date:    %s\n", commit.get("timestamp")));
            sb.append(String.format("Message: %s\n\n", commit.get("message")));
        }

        sb.append(String.format("Showing %d of %d total commits.", clampedLimit, history.size()));
        return sb.toString();
    }

    /**
     * Appends a commit entry to the brain's commit history JSONB.
     * <p>Caps history at {@value #MAX_COMMIT_HISTORY} entries by removing the oldest
     * entries when the limit is exceeded.
     *
     * @param brain   the brain entity to update
     * @param type    commit type: "strategy" or "emotion"
     * @param message descriptive commit message
     */
    private void addCommit(AgentBrain brain, String type, String message) {
        String timestamp = LocalDateTime.now().format(TIMESTAMP_FMT);
        String hashInput = type + "|" + message + "|" + timestamp;
        String hash = HashUtils.sha256(hashInput);

        Map<String, Object> commit = new LinkedHashMap<>();
        commit.put("hash", hash);
        commit.put("type", type);
        commit.put("message", message);
        commit.put("timestamp", timestamp);

        List<Map<String, Object>> history = brain.getCommitHistory();
        if (history == null) {
            history = new ArrayList<>();
            brain.setCommitHistory(history);
        }
        history.add(commit);

        // Cap at MAX_COMMIT_HISTORY by removing oldest entries
        while (history.size() > MAX_COMMIT_HISTORY) {
            history.remove(0);
        }
    }

    private String extractLatestHash(AgentBrain brain) {
        List<Map<String, Object>> history = brain.getCommitHistory();
        if (history == null || history.isEmpty()) {
            return null;
        }
        Object hash = history.getLast().get("hash");
        return hash != null ? hash.toString() : null;
    }

    private void emitEvent(UUID userId,
                           UUID brainId,
                           AgentEventType eventType,
                           Map<String, Object> payload,
                           String idempotencyKey) {
        try {
            agentEventService.append(
                    userId,
                    AgentEventAggregateType.AGENT_BRAIN,
                    brainId,
                    eventType,
                    payload,
                    idempotencyKey
            );
        } catch (Exception e) {
            log.warn("Failed to append brain event {} for user {}: {}", eventType, userId, e.getMessage());
        }
    }

}
