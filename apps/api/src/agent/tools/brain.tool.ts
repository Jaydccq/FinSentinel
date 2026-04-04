import { tool } from 'ai';
import { z } from 'zod';
import { AgentBrainService } from '../agent-brain.service';

/**
 * Cognitive state management tools (OpenAlice Brain pattern).
 *
 * userId is injected via closure (factory param), NOT as a tool parameter.
 *
 * Brain-state tool surface exposed to the agent.
 */
export function createBrainTools(
  service: AgentBrainService,
  userId: string,
) {
  return {
    readStrategy: tool({
      description:
        "Read the agent's current trading strategy and learned insights (frontal lobe). " +
        "This is the agent's persistent memory of what it has learned from past trades, " +
        'market analysis, and user interactions. Read this at the start of conversations ' +
        'to recall prior knowledge.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await service.getFrontalLobe(userId);
        } catch (e) {
          return `Error reading strategy: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    updateStrategy: tool({
      description:
        "Update the agent's trading strategy with new insights learned from trades, " +
        'market analysis, or user feedback. This persists across conversations -- the agent ' +
        'will remember these insights next time. Include what was learned and why it matters. ' +
        "A commit is automatically recorded in the brain's history.",
      inputSchema: z.object({
        content: z
          .string()
          .describe(
            "New strategy content -- the agent's updated trading insights, " +
              'learned patterns, and reasoning framework',
          ),
      }),
      execute: async ({ content }) => {
        try {
          return await service.updateFrontalLobe(userId, content);
        } catch (e) {
          return `Error updating strategy: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    reportEmotion: tool({
      description:
        "Report a change in the agent's emotional state. Valid emotions: " +
        'neutral, confident, cautious, fearful, greedy, euphoric, anxious. ' +
        'The agent should report emotion changes when market conditions shift, ' +
        'after significant trades, or when risk levels change. Include a reason ' +
        'explaining what triggered the emotional shift.',
      inputSchema: z.object({
        emotion: z
          .enum([
            'neutral',
            'confident',
            'cautious',
            'fearful',
            'greedy',
            'euphoric',
            'anxious',
          ])
          .describe(
            'New emotional state: neutral, confident, cautious, fearful, greedy, euphoric, or anxious',
          ),
        reason: z
          .string()
          .describe(
            "Reason for the emotional change, e.g. " +
              "'Portfolio dropped 5% due to tech selloff'",
          ),
      }),
      execute: async ({ emotion, reason }) => {
        try {
          return await service.updateEmotion(userId, emotion, reason);
        } catch (e) {
          return `Error reporting emotion: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    checkEmotion: tool({
      description:
        "Check the agent's current emotional state. Returns the current emotion " +
        '(e.g. neutral, confident, cautious). Use this to factor emotional awareness into ' +
        'trading decisions -- a fearful agent should be more conservative, a greedy agent ' +
        'should double-check risk levels.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await service.getEmotion(userId);
        } catch (e) {
          return `Error checking emotion: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getBrainLog: tool({
      description:
        "View the agent's cognitive commit history — a timeline of all strategy updates " +
        "and emotional state changes. Like 'git log' for the brain. Use this to review past " +
        "decisions and understand how the agent's thinking has evolved over time.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .describe('Number of recent brain commits to show (max 50)'),
      }),
      execute: async ({ limit }) => {
        try {
          return await service.getBrainLog(userId, limit);
        } catch (e) {
          return `Error fetching brain log: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
