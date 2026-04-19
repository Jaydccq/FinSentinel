import { z } from 'zod';

export const strategyTemplateKeySchema = z.enum([
  'BTC_RSI_STOCH_EMA_MEAN_REVERSION',
  'RSI_70_MOMENTUM_CONTINUATION',
  'SMA_50_200_RSI_LONG_ONLY',
]);
export type StrategyTemplateKey = z.infer<typeof strategyTemplateKeySchema>;

export const strategySignalSchema = z.enum([
  'ENTER_LONG',
  'EXIT_LONG',
  'HOLD',
  'BLOCKED',
]);
export type StrategySignal = z.infer<typeof strategySignalSchema>;

export const strategyRecommendedNextStepSchema = z.enum([
  'REJECT',
  'PAPER_ONLY',
  'REVIEW_FOR_BACKTEST',
]);
export type StrategyRecommendedNextStep = z.infer<
  typeof strategyRecommendedNextStepSchema
>;

export const strategyArchiveStatusSchema = z.enum([
  'EVALUATED',
  'SKIPPED',
  'DEGRADED',
]);
export type StrategyArchiveStatus = z.infer<typeof strategyArchiveStatusSchema>;

export const strategyIndicatorSnapshotSchema = z.object({
  close: z.number(),
  rsi14: z.number().nullable(),
  stochasticK14: z.number().nullable(),
  stochasticD3: z.number().nullable(),
  ema200: z.number().nullable(),
  sma50: z.number().nullable(),
  sma200: z.number().nullable(),
});
export type StrategyIndicatorSnapshot = z.infer<
  typeof strategyIndicatorSnapshotSchema
>;

export const strategyCostProfileSchema = z.object({
  makerFeeBps: z.number().nonnegative(),
  takerFeeBps: z.number().nonnegative(),
  estimatedRoundTripBps: z.number().nonnegative(),
  expectedAnnualTrades: z.number().int().nonnegative(),
  feeDragWarning: z.boolean(),
});
export type StrategyCostProfile = z.infer<typeof strategyCostProfileSchema>;

export const strategyTemplateEvaluationSchema = z.object({
  templateKey: strategyTemplateKeySchema,
  signal: strategySignalSchema,
  confidence: z.number().min(0).max(1),
  recommendedNextStep: strategyRecommendedNextStepSchema,
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
  requiredBars: z.number().int().positive(),
  receivedBars: z.number().int().nonnegative(),
  indicatorSnapshot: strategyIndicatorSnapshotSchema,
  costProfile: strategyCostProfileSchema,
});
export type StrategyTemplateEvaluation = z.infer<
  typeof strategyTemplateEvaluationSchema
>;

const strategyArchiveBarsSchema = z.object({
  requestedDays: z.number().int().positive(),
  receivedBars: z.number().int().nonnegative(),
  source: z.string(),
});

const strategyArchiveSummarySchema = z.object({
  enterLongCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  recommendedNextStep: strategyRecommendedNextStepSchema.nullable(),
});

const strategyArchiveDegradedSummarySchema = strategyArchiveSummarySchema.extend({
  warnings: z.array(z.string()).min(1),
});

const strategyArchiveBaseSchema = z.object({
  generatedAt: z.string().datetime(),
  bars: strategyArchiveBarsSchema,
  evaluations: z.array(strategyTemplateEvaluationSchema),
  summary: strategyArchiveSummarySchema,
});

const strategyArchiveEvaluatedSchema = strategyArchiveBaseSchema
  .extend({
    status: z.literal('EVALUATED'),
    ticker: z.string(),
    selectedTemplateKey: strategyTemplateKeySchema.nullable(),
  })
  .strict();

const strategyArchiveSkippedSchema = strategyArchiveBaseSchema
  .extend({
    status: z.literal('SKIPPED'),
    ticker: z.string().optional(),
    evaluations: z.array(strategyTemplateEvaluationSchema).length(0),
    selectedTemplateKey: z.null(),
    summary: strategyArchiveSummarySchema.extend({
      recommendedNextStep: z.literal(null),
    }),
    skipReason: z.string(),
  })
  .strict();

const strategyArchiveDegradedSchema = strategyArchiveBaseSchema
  .extend({
    status: z.literal('DEGRADED'),
    ticker: z.string().optional(),
    selectedTemplateKey: strategyTemplateKeySchema.nullable(),
    summary: strategyArchiveDegradedSummarySchema,
  })
  .strict();

export const strategyArchivePayloadSchema = z.discriminatedUnion('status', [
  strategyArchiveEvaluatedSchema,
  strategyArchiveSkippedSchema,
  strategyArchiveDegradedSchema,
]);
export type StrategyArchivePayload = z.infer<typeof strategyArchivePayloadSchema>;
