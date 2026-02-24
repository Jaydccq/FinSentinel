package com.example.finsentinel.agent.advisor;

import com.example.finsentinel.service.UserInvestmentProfileService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.AdvisorChain;
import org.springframework.ai.chat.client.advisor.api.BaseAdvisor;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

/**
 * Pre-processing advisor that automatically injects the user's investment profile
 * into the system prompt before every AI call.
 *
 * <p>This advisor reads the userId from the advisor context (set by the controller/service
 * layer via {@code .advisors(advisor -> advisor.param("userId", userId))}) and loads
 * the user's persistent Brain profile. The profile summary — including risk tolerance,
 * sentiment, working memory, and preferences — is prepended to the system text so the
 * LLM has full personalization context for every response.
 *
 * <p>Runs with order 50 (before the RAG advisor at default order, and well before the
 * compliance guardrail at order 1000).
 *
 * <p>This class is part of the agent layer in FinSentinel.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class UserContextAdvisor implements BaseAdvisor {

    private static final int ORDER = 50; // Run early, before RAG advisor
    private static final String USER_ID_KEY = "userId";

    private final UserInvestmentProfileService profileService;

    @Override
    public int getOrder() {
        return ORDER;
    }

    /**
     * Pre-processing: extracts userId from the advisor context and injects the user's
     * investment profile summary into the system prompt.
     */
    @Override
    public ChatClientRequest before(ChatClientRequest chatClientRequest, AdvisorChain advisorChain) {
        UUID userId = extractUserId(chatClientRequest);
        if (userId == null) {
            log.debug("No userId in advisor context — skipping user profile injection");
            return chatClientRequest;
        }

        try {
            String profileSummary = profileService.getProfileSummary(userId);
            if (profileSummary == null || profileSummary.isBlank()) {
                log.debug("No profile found for user {} — skipping injection", userId);
                return chatClientRequest;
            }

            // Augment the system message with user investment profile context
            // Uses Prompt.augmentSystemMessage() which prepends text to the existing system message
            var enrichedPrompt = chatClientRequest.prompt().augmentSystemMessage(profileSummary);

            log.debug("Injected user investment profile for user {} into system prompt", userId);

            return chatClientRequest.mutate()
                    .prompt(enrichedPrompt)
                    .build();

        } catch (Exception e) {
            log.warn("Failed to load user profile for {} — proceeding without it: {}",
                    userId, e.getMessage());
            return chatClientRequest;
        }
    }

    /**
     * Post-processing: no modification needed — user context is pre-processing only.
     */
    @Override
    public ChatClientResponse after(ChatClientResponse chatClientResponse, AdvisorChain advisorChain) {
        return chatClientResponse;
    }

    /**
     * Extracts the userId from the ChatClientRequest context.
     * Supports both UUID objects and String representations.
     */
    private UUID extractUserId(ChatClientRequest chatClientRequest) {
        Map<String, Object> context = chatClientRequest.context();
        if (context == null || !context.containsKey(USER_ID_KEY)) {
            return null;
        }

        Object userIdObj = context.get(USER_ID_KEY);
        if (userIdObj instanceof UUID uuid) {
            return uuid;
        }
        if (userIdObj instanceof String str) {
            try {
                return UUID.fromString(str);
            } catch (IllegalArgumentException e) {
                log.warn("Invalid userId string in advisor context: {}", str);
                return null;
            }
        }

        log.warn("Unexpected userId type in advisor context: {}", userIdObj.getClass().getName());
        return null;
    }
}
