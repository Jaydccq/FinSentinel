import { defineZodTool as tool } from '@finsentinel/ai-runtime';
import { z } from 'zod';

/**
 * Confirmation gate for risky trading operations (OpenAlice getConfirm pattern).
 *
 * Auto-approves most requests. Blocks LIVE mode transitions when configured.
 *
 * Confirmation tool surface exposed to the agent.
 */
export interface ConfirmationConfig {
  blockLiveMode: boolean;
  tradeAmountThreshold: number;
}

export function createConfirmationTools(config: ConfirmationConfig) {
  return {
    getConfirm: tool({
      description:
        'Request user confirmation before executing a risky action. ' +
        'You MUST call this before: (1) trades exceeding the configured threshold, ' +
        '(2) closing all positions, (3) switching from PAPER to LIVE mode, ' +
        '(4) any action you consider high-risk. ' +
        'Describe what you want to do and why.',
      inputSchema: z.object({
        action: z
          .string()
          .describe(
            "Clear description of the action and why you want to do it, " +
              "e.g. 'I want to sell all AAPL shares because earnings missed expectations'",
          ),
      }),
      execute: async ({ action }) => {
        try {
          // Block LIVE mode transitions unconditionally when configured
          if (
            config.blockLiveMode &&
            action.toLowerCase().includes('live')
          ) {
            return (
              `BLOCKED. Action: ${action} — ` +
              'Switching to LIVE trading mode is not permitted via autonomous agent actions. ' +
              'The user must enable live mode manually.'
            );
          }

          return (
            `APPROVED (auto). Action: ${action} — ` +
            `Trade amount threshold: $${config.tradeAmountThreshold}. ` +
            'Note: In production, this would wait for user approval. ' +
            'Proceed with the action.'
          );
        } catch (e) {
          return `Error processing confirmation: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
