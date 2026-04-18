import { defineZodTool as tool } from '@finsentinel/ai-runtime';
import { z } from 'zod';
import type { StrategyTemplateService } from '../../market/strategy-template.service';

const strategyTemplateKeySchema = z.enum([
  'BTC_RSI_STOCH_EMA_MEAN_REVERSION',
  'RSI_70_MOMENTUM_CONTINUATION',
  'SMA_50_200_RSI_LONG_ONLY',
]);

/**
 * Strategy template tools expose analysis-only strategy quality checks.
 * They do not stage, commit, or execute trades.
 */
export function createStrategyTemplateTools(
  strategyTemplateService: StrategyTemplateService,
) {
  return {
    evaluateStrategyTemplate: tool({
      description:
        'Evaluate a high-quality strategy template against OHLCV bars. ' +
        'Returns an analysis-only signal, confidence, indicator snapshot, cost profile, warnings, and next step. ' +
        'Use this after getHistoricalPrices when comparing low-frequency strategy templates before any trade planning.',
      inputSchema: z.object({
        barsJson: z
          .string()
          .describe('JSON array of OHLCV bars [{o,h,l,c,v,t}, ...] from getHistoricalPrices'),
        templateKey: strategyTemplateKeySchema.describe(
          'Strategy template to evaluate: RSI/Stochastic/EMA mean reversion, RSI 70 momentum, or SMA50/200 long-only trend',
        ),
        makerFeeBps: z
          .number()
          .nonnegative()
          .optional()
          .describe('Optional maker fee in basis points. Defaults to 1.5 bps.'),
        takerFeeBps: z
          .number()
          .nonnegative()
          .optional()
          .describe('Optional taker fee in basis points. Defaults to 4.5 bps.'),
        expectedAnnualTrades: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Optional expected annual trade count for fee-drag warnings. Defaults to 36.'),
      }),
      execute: async ({
        barsJson,
        templateKey,
        makerFeeBps,
        takerFeeBps,
        expectedAnnualTrades,
      }) => {
        try {
          const evaluation = strategyTemplateService.evaluate({
            barsJson,
            templateKey,
            makerFeeBps,
            takerFeeBps,
            expectedAnnualTrades,
          });

          return JSON.stringify(evaluation, null, 2);
        } catch (e) {
          return `Error evaluating strategy template: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
