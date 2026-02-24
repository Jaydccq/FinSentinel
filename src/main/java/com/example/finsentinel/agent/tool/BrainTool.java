package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.trading.AgentBrainService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * AI agent tool for cognitive state management using the OpenAlice Brain pattern.
 *
 * <p>Exposes four operations to the LLM for persistent memory across conversations:
 * <ul>
 *   <li><b>readStrategy</b> -- retrieve the agent's learned trading strategy (frontal lobe)</li>
 *   <li><b>updateStrategy</b> -- update strategy based on new insights from trades or analysis</li>
 *   <li><b>checkEmotion</b> -- read the agent's current emotional state</li>
 *   <li><b>reportEmotion</b> -- update emotional state with a reason for the change</li>
 * </ul>
 *
 * <p>Every update is recorded as an immutable commit in the brain's history, providing
 * a full audit trail of cognitive state evolution.
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class BrainTool {

    private final AgentBrainService brainService;

    @Tool(description = "Read the agent's current trading strategy and learned insights (frontal lobe). " +
            "This is the agent's persistent memory of what it has learned from past trades, " +
            "market analysis, and user interactions. Read this at the start of conversations " +
            "to recall prior knowledge.")
    public String readStrategy(
            @ToolParam(description = "User UUID") String userId) {
        try {
            UUID id = UUID.fromString(userId);
            return brainService.getFrontalLobe(id);
        } catch (IllegalArgumentException e) {
            log.error("Invalid user ID: {}", userId);
            return "Error: Invalid user ID format -- " + userId;
        } catch (Exception e) {
            log.error("Failed to read strategy for user {}", userId, e);
            return "Error reading strategy: " + e.getMessage();
        }
    }

    @Tool(description = "Update the agent's trading strategy with new insights learned from trades, " +
            "market analysis, or user feedback. This persists across conversations -- the agent " +
            "will remember these insights next time. Include what was learned and why it matters. " +
            "A commit is automatically recorded in the brain's history.")
    public String updateStrategy(
            @ToolParam(description = "User UUID") String userId,
            @ToolParam(description = "New strategy content -- the agent's updated trading insights, " +
                    "learned patterns, and reasoning framework") String content) {
        try {
            UUID id = UUID.fromString(userId);
            return brainService.updateFrontalLobe(id, content);
        } catch (IllegalArgumentException e) {
            log.error("Invalid update strategy request: {}", e.getMessage());
            return "Error updating strategy: " + e.getMessage();
        } catch (Exception e) {
            log.error("Failed to update strategy for user {}", userId, e);
            return "Error updating strategy: " + e.getMessage();
        }
    }

    @Tool(description = "Report a change in the agent's emotional state. Valid emotions: " +
            "neutral, confident, cautious, fearful, greedy, euphoric, anxious. " +
            "The agent should report emotion changes when market conditions shift, " +
            "after significant trades, or when risk levels change. Include a reason " +
            "explaining what triggered the emotional shift.")
    public String reportEmotion(
            @ToolParam(description = "User UUID") String userId,
            @ToolParam(description = "New emotional state: neutral, confident, cautious, " +
                    "fearful, greedy, euphoric, or anxious") String emotion,
            @ToolParam(description = "Reason for the emotional change, e.g. " +
                    "'Portfolio dropped 5% due to tech selloff'") String reason) {
        try {
            UUID id = UUID.fromString(userId);
            return brainService.updateEmotion(id, emotion, reason);
        } catch (IllegalArgumentException e) {
            log.error("Invalid emotion report request: {}", e.getMessage());
            return "Error reporting emotion: " + e.getMessage();
        } catch (Exception e) {
            log.error("Failed to report emotion for user {}", userId, e);
            return "Error reporting emotion: " + e.getMessage();
        }
    }

    @Tool(description = "Check the agent's current emotional state. Returns the current emotion " +
            "(e.g. neutral, confident, cautious). Use this to factor emotional awareness into " +
            "trading decisions -- a fearful agent should be more conservative, a greedy agent " +
            "should double-check risk levels.")
    public String checkEmotion(
            @ToolParam(description = "User UUID") String userId) {
        try {
            UUID id = UUID.fromString(userId);
            return brainService.getEmotion(id);
        } catch (IllegalArgumentException e) {
            log.error("Invalid user ID: {}", userId);
            return "Error: Invalid user ID format -- " + userId;
        } catch (Exception e) {
            log.error("Failed to check emotion for user {}", userId, e);
            return "Error checking emotion: " + e.getMessage();
        }
    }
}
