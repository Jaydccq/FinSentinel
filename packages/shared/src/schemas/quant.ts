import { z } from 'zod';

// --- VolatilityAnalysis ---
export const volatilityAnalysisSchema = z.object({
  currentVolatility: z.number(),
  historicalVolatility: z.number(),
  volatilityPercentile: z.number(),
  regime: z.string(),
  rollingVolatility: z.array(z.number()),
});
export type VolatilityAnalysis = z.infer<typeof volatilityAnalysisSchema>;

// --- ValueAtRisk ---
export const valueAtRiskSchema = z.object({
  var95: z.number(),
  var99: z.number(),
  cvar95: z.number(),
  cvar99: z.number(),
  method: z.string(),
});
export type ValueAtRisk = z.infer<typeof valueAtRiskSchema>;

// --- ReturnStatistics ---
export const returnStatisticsSchema = z.object({
  meanReturn: z.number(),
  annualizedReturn: z.number(),
  standardDeviation: z.number(),
  annualizedVolatility: z.number(),
  skewness: z.number(),
  kurtosis: z.number(),
  maxDrawdown: z.number(),
  sharpeRatio: z.number(),
  dataPoints: z.number().int(),
});
export type ReturnStatistics = z.infer<typeof returnStatisticsSchema>;
