package com.example.finsentinel.agent.tool;

import com.example.finsentinel.service.UserInvestmentProfileService;
import com.example.finsentinel.util.SecurityUtils;
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
    public String getUserInvestmentProfile() {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            String summary = profileService.getProfileSummary(userId);
            if (summary == null || summary.isBlank()) {
                profileService.getOrCreateProfile(userId);
                summary = profileService.getProfileSummary(userId);
            }
            return summary;
        } catch (Exception e) {
            log.error("Failed to get investment profile", e);
            return "Error fetching user investment profile: " + e.getMessage();
        }
    }

    @Tool(description = "Update the user's investment sentiment when you detect their emotional state " +
            "has changed during conversation. Sentiment must be one of: FEARFUL, CAUTIOUS, NEUTRAL, " +
            "OPTIMISTIC, EUPHORIC. Always provide a reason explaining what triggered the change.")
    public String updateUserSentiment(
            @ToolParam(description = "New sentiment: FEARFUL, CAUTIOUS, NEUTRAL, OPTIMISTIC, or EUPHORIC") String sentiment,
            @ToolParam(description = "Reason for the sentiment change, e.g. 'User expressed concern about market volatility'") String reason) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            profileService.updateSentiment(userId, sentiment.toUpperCase().trim(), reason);
            return "Sentiment updated to " + sentiment.toUpperCase().trim() + " for reason: " + reason;
        } catch (Exception e) {
            log.error("Failed to update sentiment", e);
            return "Error updating user sentiment: " + e.getMessage();
        }
    }

    @Tool(description = "Save key observations about the user's current investment focus to working memory. " +
            "Use this to record what the user is currently concerned about or investigating, " +
            "e.g. 'User is concerned about NVDA earnings next week and considering reducing tech exposure'.")
    public String updateWorkingMemory(
            @ToolParam(description = "Concise summary (2-5 sentences) of the user's current investment focus and concerns") String memory) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            profileService.updateWorkingMemory(userId, memory);
            return "Working memory updated: " + memory;
        } catch (Exception e) {
            log.error("Failed to update working memory", e);
            return "Error updating working memory: " + e.getMessage();
        }
    }

    @Tool(description = "Update the user's investment preferences when they explicitly mention " +
            "watchlist tickers, preferred sectors, sectors to avoid, or preferred analysis types. " +
            "Input is a JSON string with keys like 'watchlist', 'sectors', 'avoidSectors', 'preferredAnalysis'.")
    @SuppressWarnings("unchecked")
    public String updateUserPreferences(
            @ToolParam(description = "JSON string of preferences, e.g. {\"watchlist\":[\"AAPL\",\"TSLA\"],\"sectors\":[\"Technology\"]}") String preferencesJson) {
        try {
            UUID userId = SecurityUtils.getCurrentUserId();
            Map<String, Object> preferences = objectMapper.readValue(preferencesJson, Map.class);
            profileService.updatePreferences(userId, preferences);
            return "Preferences updated: " + preferences.keySet();
        } catch (Exception e) {
            log.error("Failed to update preferences", e);
            return "Error updating preferences: " + e.getMessage();
        }
    }
}
