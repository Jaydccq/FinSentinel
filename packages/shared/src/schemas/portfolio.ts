import { z } from 'zod';

// --- PortfolioRequest ---
export const portfolioRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
export type PortfolioRequest = z.infer<typeof portfolioRequestSchema>;

// --- HoldingRequest ---
export const holdingRequestSchema = z.object({
  symbol: z.string().min(1),
  companyName: z.string().optional(),
  quantity: z.string().refine((v) => parseFloat(v) > 0, {
    message: 'Quantity must be positive',
  }),
  averageCost: z.string().refine((v) => parseFloat(v) > 0, {
    message: 'Average cost must be positive',
  }),
  sector: z.string().optional(),
});
export type HoldingRequest = z.infer<typeof holdingRequestSchema>;

// --- HoldingResponse ---
export const holdingResponseSchema = z.object({
  id: z.string().uuid(),
  symbol: z.string(),
  companyName: z.string(),
  quantity: z.string(),
  averageCost: z.string(),
  currentPrice: z.string(),
  sector: z.string(),
});
export type HoldingResponse = z.infer<typeof holdingResponseSchema>;

// --- PortfolioResponse ---
export const portfolioResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  totalValue: z.string(),
  holdings: z.array(holdingResponseSchema),
  createdAt: z.string().datetime(),
});
export type PortfolioResponse = z.infer<typeof portfolioResponseSchema>;

// --- HoldingWeight (nested record) ---
export const holdingWeightSchema = z.object({
  symbol: z.string(),
  companyName: z.string(),
  sector: z.string(),
  marketValue: z.string(),
  weightPercent: z.string(),
  unrealizedPnl: z.string(),
  pnlPercent: z.string(),
});
export type HoldingWeight = z.infer<typeof holdingWeightSchema>;

// --- PortfolioAnalyticsResponse ---
export const portfolioAnalyticsResponseSchema = z.object({
  totalMarketValue: z.string(),
  sectorAllocation: z.record(z.string(), z.string()),
  hhiIndex: z.number(),
  hhiClassification: z.string(),
  holdingWeights: z.array(holdingWeightSchema),
  concentrationWarnings: z.array(z.string()),
});
export type PortfolioAnalyticsResponse = z.infer<typeof portfolioAnalyticsResponseSchema>;
