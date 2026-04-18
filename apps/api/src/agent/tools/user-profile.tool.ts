import { defineZodTool as tool } from '@finsentinel/ai-runtime';
import { z } from 'zod';
import { UserInvestmentProfileService } from '../user-investment-profile.service';

/**
 * User investment profile tools — read/update user risk tolerance,
 * sentiment, working memory, and preferences.
 *
 * userId is injected via closure (factory param), NOT as a tool parameter.
 *
 * User-profile tool surface exposed to the agent.
 */
export function createUserProfileTools(
  service: UserInvestmentProfileService,
  userId: string,
) {
  return {
    getUserInvestmentProfile: tool({
      description:
        "Get the user's investment profile including risk tolerance, current sentiment, " +
        'working memory (current focus/concerns), preferences (watchlist, sectors), and recent state changes. ' +
        "Use this to personalize risk assessments and understand the user's investment context.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await service.getProfileSummary(userId);
        } catch (e) {
          return `Error fetching user investment profile: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    updateUserSentiment: tool({
      description:
        "Update the user's investment sentiment when you detect their emotional state " +
        'has changed during conversation. Sentiment must be one of: FEARFUL, CAUTIOUS, NEUTRAL, ' +
        'OPTIMISTIC, EUPHORIC. Always provide a reason explaining what triggered the change.',
      inputSchema: z.object({
        sentiment: z
          .enum(['FEARFUL', 'CAUTIOUS', 'NEUTRAL', 'OPTIMISTIC', 'EUPHORIC'])
          .describe(
            'New sentiment: FEARFUL, CAUTIOUS, NEUTRAL, OPTIMISTIC, or EUPHORIC',
          ),
        reason: z
          .string()
          .describe(
            "Reason for the sentiment change, e.g. 'User expressed concern about market volatility'",
          ),
      }),
      execute: async ({ sentiment, reason }) => {
        try {
          return await service.updateSentiment(userId, sentiment, reason);
        } catch (e) {
          return `Error updating user sentiment: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    updateWorkingMemory: tool({
      description:
        "Save key observations about the user's current investment focus to working memory. " +
        'Use this to record what the user is currently concerned about or investigating, ' +
        "e.g. 'User is concerned about NVDA earnings next week and considering reducing tech exposure'.",
      inputSchema: z.object({
        memory: z
          .string()
          .describe(
            "Concise summary (2-5 sentences) of the user's current investment focus and concerns",
          ),
      }),
      execute: async ({ memory }) => {
        try {
          return await service.updateWorkingMemory(userId, memory);
        } catch (e) {
          return `Error updating working memory: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    updateUserPreferences: tool({
      description:
        "Update the user's investment preferences when they explicitly mention " +
        'watchlist tickers, preferred sectors, sectors to avoid, or preferred analysis types. ' +
        "Input is a JSON string with keys like 'watchlist', 'sectors', 'avoidSectors', 'preferredAnalysis'.",
      inputSchema: z.object({
        preferencesJson: z
          .string()
          .describe(
            'JSON string of preferences, e.g. {"watchlist":["AAPL","TSLA"],"sectors":["Technology"]}',
          ),
      }),
      execute: async ({ preferencesJson }) => {
        try {
          return await service.updatePreferences(userId, preferencesJson);
        } catch (e) {
          return `Error updating preferences: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
