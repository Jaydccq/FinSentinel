import { z } from 'zod';

// --- RelevantEvent (nested) ---
export const relevantEventSchema = z.object({
  headline: z.string(),
  source: z.string(),
  publishedAt: z.string().datetime(),
  impactedSymbols: z.array(z.string()),
  relevanceReason: z.string(),
});
export type RelevantEvent = z.infer<typeof relevantEventSchema>;

// --- PortfolioInsight ---
export const portfolioInsightSchema = z.object({
  portfolioId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  freshness: z.enum(['full', 'degraded', 'empty']),

  // Core risk primitives (deterministic)
  riskScore: z.number().int().min(0).max(100),
  riskLevel: z.string(),
  hhiIndex: z.number(),
  hhiClassification: z.string(),
  topHoldingSymbol: z.string().nullable(),
  topHoldingWeightPercent: z.string().nullable(),
  sectorCount: z.number().int(),
  concentrationWarnings: z.array(z.string()),
  holdingCount: z.number().int().min(0),

  // Event context
  relevantEvents: z.array(relevantEventSchema),

  // Priority actions (deterministic)
  priorityActions: z.array(z.string()),

  // Narration (LLM-generated, optional)
  narration: z.string().nullable(),
  narrationFailed: z.boolean(),
});
export type PortfolioInsight = z.infer<typeof portfolioInsightSchema>;
