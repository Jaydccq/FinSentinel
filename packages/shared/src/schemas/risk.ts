import { z } from 'zod';

// --- RiskFactor ---
export const riskFactorSchema = z.object({
  category: z.string(),
  score: z.number().int(),
  description: z.string(),
});
export type RiskFactor = z.infer<typeof riskFactorSchema>;

// --- RiskReport ---
export const riskReportSchema = z.object({
  riskScore: z.number().int(),
  riskLevel: z.string(),
  summary: z.string(),
  factors: z.array(riskFactorSchema),
  actionableAdvice: z.array(z.string()),
});
export type RiskReport = z.infer<typeof riskReportSchema>;

// --- RiskReportSummary ---
export const riskReportSummarySchema = z.object({
  id: z.string().uuid(),
  riskScore: z.number().int(),
  riskLevel: z.string(),
  summary: z.string(),
  factors: z.array(riskFactorSchema),
  actionableAdvice: z.array(z.string()),
  createdAt: z.string().datetime(),
});
export type RiskReportSummary = z.infer<typeof riskReportSummarySchema>;
