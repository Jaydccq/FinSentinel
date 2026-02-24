package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.UserInvestmentProfileService;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

/**
 * AI agent tool for reading and updating the user's persistent investment profile (Brain).
 *
 * <p>The LLM uses these tools to:
 * <ul>
 *   <li>Understand the user's risk tolerance, sentiment, and preferences</li>
 *   <li>Track sentiment shifts detected during conversation</li>
 *   <li>Save key observations about the user's investment focus</li>
 *   <li>Record explicit preference changes (watchlist, sectors, analysis types)</li>
 * </ul>
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class UserProfileTool {

    private final UserInvestmentProfileService profileService;
    private final ObjectMapper objectMapper;

    @Tool(description = "Get the user's investment profile including risk tolerance, current sentiment, " +
            "working memory (current focus/concerns), preferences (watchlist, sectors), and recent state changes. " +
            "Use this to personalize risk assessments and understand the user's investment context.")
    public String getUserInvestmentProfile(
            @ToolParam(description = "User UUID") String userId) {
        try {
            UUID id = UUID.fromString(userId);
            String summary = profileService.getProfileSummary(id);
            if (summary == null || summary.isBlank()) {
                // Trigger profile creation and return the fresh summary
                profileService.getOrCreateProfile(id);
                summary = profileService.getProfileSummary(id);
            }
            return summary;
        } catch (IllegalArgumentException e) {
            log.error("Invalid user ID format: {}", userId, e);
            return "Error: Invalid user ID format — " + userId;
        } catch (Exception e) {
            log.error("Failed to get investment profile for user {}", userId, e);
            return "Error fetching user investment profile: " + e.getMessage();
        }
    }

    @Tool(description = "Update the user's investment sentiment when you detect their emotional state " +
            "has changed during conversation. Sentiment must be one of: FEARFUL, CAUTIOUS, NEUTRAL, " +
            "OPTIMISTIC, EUPHORIC. Always provide a reason explaining what triggered the change.")
    public String updateUserSentiment(
            @ToolParam(description = "User UUID") String userId,
            @ToolParam(description = "New sentiment: FEARFUL, CAUTIOUS, NEUTRAL, OPTIMISTIC, or EUPHORIC") String sentiment,
            @ToolParam(description = "Reason for the sentiment change, e.g. 'User expressed concern about market volatility'") String reason) {
        try {
            UUID id = UUID.fromString(userId);
            profileService.updateSentiment(id, sentiment.toUpperCase().trim(), reason);
            return "Sentiment updated to " + sentiment.toUpperCase().trim() + " for reason: " + reason;
        } catch (IllegalArgumentException e) {
            log.error("Failed to update sentiment for user {}: {}", userId, e.getMessage());
            return "Error updating sentiment: " + e.getMessage();
        } catch (Exception e) {
            log.error("Failed to update sentiment for user {}", userId, e);
            return "Error updating user sentiment: " + e.getMessage();
        }
    }

    @Tool(description = "Save key observations about the user's current investment focus to working memory. " +
            "Use this to record what the user is currently concerned about or investigating, " +
            "e.g. 'User is concerned about NVDA earnings next week and considering reducing tech exposure'.")
    public String updateWorkingMemory(
            @ToolParam(description = "User UUID") String userId,
            @ToolParam(description = "Concise summary (2-5 sentences) of the user's current investment focus and concerns") String memory) {
        try {
            UUID id = UUID.fromString(userId);
            profileService.updateWorkingMemory(id, memory);
            return "Working memory updated: " + memory;
        } catch (IllegalArgumentException e) {
            log.error("Invalid user ID format: {}", userId, e);
            return "Error: Invalid user ID format — " + userId;
        } catch (Exception e) {
            log.error("Failed to update working memory for user {}", userId, e);
            return "Error updating working memory: " + e.getMessage();
        }
    }

    @Tool(description = "Update the user's investment preferences when they explicitly mention " +
            "watchlist tickers, preferred sectors, sectors to avoid, or preferred analysis types. " +
            "Input is a JSON string with keys like 'watchlist', 'sectors', 'avoidSectors', 'preferredAnalysis'.")
    @SuppressWarnings("unchecked")
    public String updateUserPreferences(
            @ToolParam(description = "User UUID") String userId,
            @ToolParam(description = "JSON string of preferences, e.g. {\"watchlist\":[\"AAPL\",\"TSLA\"],\"sectors\":[\"Technology\"]}") String preferencesJson) {
        try {
            UUID id = UUID.fromString(userId);
            Map<String, Object> preferences = objectMapper.readValue(preferencesJson, Map.class);
            profileService.updatePreferences(id, preferences);
            return "Preferences updated: " + preferences.keySet();
        } catch (IllegalArgumentException e) {
            log.error("Invalid user ID format: {}", userId, e);
            return "Error: Invalid user ID format — " + userId;
        } catch (Exception e) {
            log.error("Failed to update preferences for user {}", userId, e);
            return "Error updating preferences: " + e.getMessage();
        }
    }
}
