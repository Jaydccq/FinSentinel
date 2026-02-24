package com.example.finsentinel.service;

import com.example.finsentinel.model.User;
import com.example.finsentinel.model.UserInvestmentProfile;
import com.example.finsentinel.repository.UserInvestmentProfileRepository;
import com.example.finsentinel.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Manages the persistent "Brain" for each user — investment preferences, risk tolerance,
 * emotional state tracking, and state history commits (OpenAlice commit pattern).
 *
 * <p>This class is part of the service layer in FinSentinel.
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class UserInvestmentProfileService {

    private static final int MAX_STATE_HISTORY = 50;

    private final UserInvestmentProfileRepository profileRepository;
    private final UserRepository userRepository;

    /**
     * Finds an existing profile or creates a default one for the given user.
     *
     * @param userId the user's UUID
     * @return the user's investment profile (never null)
     */
    public UserInvestmentProfile getOrCreateProfile(UUID userId) {
        return profileRepository.findByUserId(userId)
                .orElseGet(() -> createDefaultProfile(userId));
    }

    /**
     * Updates the frontal lobe working memory with a summary of the user's current
     * investment focus and concerns.
     *
     * @param userId the user's UUID
     * @param memory concise summary (2-5 sentences) of current investment focus
     */
    public void updateWorkingMemory(UUID userId, String memory) {
        UserInvestmentProfile profile = getOrCreateProfile(userId);
        String oldMemory = profile.getWorkingMemory();
        profile.setWorkingMemory(memory);
        addStateCommit(profile, "workingMemory", oldMemory, memory, "Working memory updated by AI agent");
        profileRepository.save(profile);
        log.info("Updated working memory for user {}", userId);
    }

    /**
     * Updates the user's investment sentiment with a state history commit.
     * Validates the sentiment value against the allowed enum values.
     *
     * @param userId    the user's UUID
     * @param sentiment one of: FEARFUL, CAUTIOUS, NEUTRAL, OPTIMISTIC, EUPHORIC
     * @param reason    explanation for why the sentiment changed
     * @throws IllegalArgumentException if the sentiment value is not valid
     */
    public void updateSentiment(UUID userId, String sentiment, String reason) {
        validateSentiment(sentiment);
        UserInvestmentProfile profile = getOrCreateProfile(userId);

        String oldSentiment = profile.getCurrentSentiment();
        profile.setCurrentSentiment(sentiment);
        profile.setSentimentReason(reason);

        addStateCommit(profile, "sentiment", oldSentiment, sentiment, reason);
        profileRepository.save(profile);
        log.info("Updated sentiment for user {}: {} -> {} (reason: {})",
                userId, oldSentiment, sentiment, reason);
    }

    /**
     * Updates the user's risk tolerance and investment horizon.
     *
     * @param userId            the user's UUID
     * @param riskTolerance     one of: CONSERVATIVE, MODERATE, AGGRESSIVE
     * @param investmentHorizon one of: SHORT_TERM, MEDIUM_TERM, LONG_TERM
     */
    public void updateRiskProfile(UUID userId, String riskTolerance, String investmentHorizon) {
        UserInvestmentProfile profile = getOrCreateProfile(userId);

        if (riskTolerance != null) {
            String oldTolerance = profile.getRiskTolerance();
            profile.setRiskTolerance(riskTolerance);
            addStateCommit(profile, "riskTolerance", oldTolerance, riskTolerance, "Risk profile updated");
        }

        if (investmentHorizon != null) {
            String oldHorizon = profile.getInvestmentHorizon();
            profile.setInvestmentHorizon(investmentHorizon);
            addStateCommit(profile, "investmentHorizon", oldHorizon, investmentHorizon, "Risk profile updated");
        }

        profileRepository.save(profile);
        log.info("Updated risk profile for user {}: tolerance={}, horizon={}",
                userId, riskTolerance, investmentHorizon);
    }

    /**
     * Merges the given preferences into the user's existing preferences map.
     * Existing keys are overwritten; new keys are added.
     *
     * @param userId      the user's UUID
     * @param preferences key-value map to merge (e.g., watchlist, sectors, avoidSectors)
     */
    public void updatePreferences(UUID userId, Map<String, Object> preferences) {
        UserInvestmentProfile profile = getOrCreateProfile(userId);

        Map<String, Object> existing = profile.getPreferences();
        if (existing == null) {
            existing = new HashMap<>();
        }
        existing.putAll(preferences);
        profile.setPreferences(existing);

        addStateCommit(profile, "preferences", null, preferences.keySet().toString(),
                "Preferences updated: " + preferences.keySet());
        profileRepository.save(profile);
        log.info("Updated preferences for user {}: keys={}", userId, preferences.keySet());
    }

    /**
     * Returns a formatted text summary of the user's investment profile,
     * suitable for injection into the AI system prompt.
     *
     * @param userId the user's UUID
     * @return formatted profile summary, or empty string if no profile exists
     */
    @Transactional(readOnly = true)
    public String getProfileSummary(UUID userId) {
        Optional<UserInvestmentProfile> profileOpt = profileRepository.findByUserId(userId);
        if (profileOpt.isEmpty()) {
            return "";
        }

        UserInvestmentProfile profile = profileOpt.get();
        StringBuilder sb = new StringBuilder();
        sb.append("=== User Investment Profile ===\n");

        // Risk profile
        if (profile.getRiskTolerance() != null) {
            sb.append("Risk Tolerance: ").append(profile.getRiskTolerance()).append("\n");
        }
        if (profile.getInvestmentHorizon() != null) {
            sb.append("Investment Horizon: ").append(profile.getInvestmentHorizon()).append("\n");
        }

        // Emotional state
        if (profile.getCurrentSentiment() != null) {
            sb.append("Current Sentiment: ").append(profile.getCurrentSentiment());
            if (profile.getSentimentReason() != null) {
                sb.append(" (").append(profile.getSentimentReason()).append(")");
            }
            sb.append("\n");
        }

        // Working memory
        if (profile.getWorkingMemory() != null && !profile.getWorkingMemory().isBlank()) {
            sb.append("Current Focus: ").append(profile.getWorkingMemory()).append("\n");
        }

        // Preferences
        Map<String, Object> prefs = profile.getPreferences();
        if (prefs != null && !prefs.isEmpty()) {
            if (prefs.containsKey("watchlist")) {
                sb.append("Watchlist: ").append(prefs.get("watchlist")).append("\n");
            }
            if (prefs.containsKey("sectors")) {
                sb.append("Preferred Sectors: ").append(prefs.get("sectors")).append("\n");
            }
            if (prefs.containsKey("avoidSectors")) {
                sb.append("Sectors to Avoid: ").append(prefs.get("avoidSectors")).append("\n");
            }
            if (prefs.containsKey("preferredAnalysis")) {
                sb.append("Preferred Analysis: ").append(prefs.get("preferredAnalysis")).append("\n");
            }
        }

        // Recent state changes (last 5)
        List<Map<String, Object>> history = profile.getStateHistory();
        if (history != null && !history.isEmpty()) {
            sb.append("\nRecent Profile Changes:\n");
            int start = Math.max(0, history.size() - 5);
            for (int i = history.size() - 1; i >= start; i--) {
                Map<String, Object> commit = history.get(i);
                sb.append("  - [").append(commit.getOrDefault("timestamp", "?")).append("] ");
                sb.append(commit.getOrDefault("field", "?")).append(": ");
                sb.append(commit.getOrDefault("oldValue", "null")).append(" -> ");
                sb.append(commit.getOrDefault("newValue", "null"));
                Object reason = commit.get("reason");
                if (reason != null) {
                    sb.append(" (").append(reason).append(")");
                }
                sb.append("\n");
            }
        }

        sb.append("=== End User Profile ===\n");
        return sb.toString();
    }

    // --- Private helpers ---

    private UserInvestmentProfile createDefaultProfile(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + userId));

        UserInvestmentProfile profile = UserInvestmentProfile.builder()
                .user(user)
                .riskTolerance("MODERATE")
                .investmentHorizon("MEDIUM_TERM")
                .currentSentiment("NEUTRAL")
                .sentimentReason("Default initial state")
                .workingMemory(null)
                .preferences(new HashMap<>())
                .stateHistory(new ArrayList<>())
                .build();

        profile = profileRepository.save(profile);
        log.info("Created default investment profile for user {}", userId);
        return profile;
    }

    private void addStateCommit(UserInvestmentProfile profile, String field,
                                Object oldValue, Object newValue, String reason) {
        List<Map<String, Object>> history = profile.getStateHistory();
        if (history == null) {
            history = new ArrayList<>();
            profile.setStateHistory(history);
        }

        Map<String, Object> commit = new HashMap<>();
        commit.put("timestamp", LocalDateTime.now().toString());
        commit.put("field", field);
        commit.put("oldValue", oldValue != null ? oldValue.toString() : null);
        commit.put("newValue", newValue != null ? newValue.toString() : null);
        commit.put("reason", reason);
        history.add(commit);

        // Cap at MAX_STATE_HISTORY entries
        while (history.size() > MAX_STATE_HISTORY) {
            history.remove(0);
        }
    }

    private void validateSentiment(String sentiment) {
        Set<String> valid = Set.of("FEARFUL", "CAUTIOUS", "NEUTRAL", "OPTIMISTIC", "EUPHORIC");
        if (sentiment == null || !valid.contains(sentiment.toUpperCase())) {
            throw new IllegalArgumentException(
                    "Invalid sentiment: '" + sentiment + "'. Must be one of: " + valid);
        }
    }
}
