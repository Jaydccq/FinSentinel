import { z } from 'zod';
import { TradingMode } from '../enums';

// --- StageRequest ---
export const stageRequestSchema = z.object({
  action: z.string().regex(/^(BUY|SELL|CLOSE)$/, 'Action must be BUY, SELL, or CLOSE'),
  ticker: z.string().min(1),
  shares: z.string().optional(),
  amount: z.string().optional(),
});
export type StageRequest = z.infer<typeof stageRequestSchema>;

// --- UnifiedStageRequest ---
export const unifiedStageRequestSchema = z.object({
  action: z.string().regex(/^(BUY|SELL|CLOSE)$/, 'Action must be BUY, SELL, or CLOSE'),
  symbol: z.string().min(1).max(50),
  qty: z.string().max(30).optional(),
  amount: z.string().max(30).optional(),
  price: z.string().max(30).optional(),
});
export type UnifiedStageRequest = z.infer<typeof unifiedStageRequestSchema>;

// --- CommitRequest ---
export const commitRequestSchema = z.object({
  message: z.string().min(1),
});
export type CommitRequest = z.infer<typeof commitRequestSchema>;

// --- SimulateRequest ---
export const simulateRequestSchema = z.object({
  ticker: z.string().min(1),
  changePercent: z.number(),
});
export type SimulateRequest = z.infer<typeof simulateRequestSchema>;

// --- SwitchModeRequest ---
const tradingModeValues = Object.values(TradingMode) as [string, ...string[]];
export const switchModeRequestSchema = z.object({
  mode: z.enum(tradingModeValues),
});
export type SwitchModeRequest = z.infer<typeof switchModeRequestSchema>;

// --- WalletResponse ---
export const walletResponseSchema = z.object({
  initialCapital: z.string(),
  cashBalance: z.string(),
  positions: z.array(z.record(z.string(), z.unknown())),
  totalValue: z.string(),
  returnPercent: z.string(),
  tradingMode: z.enum(tradingModeValues),
});
export type WalletResponse = z.infer<typeof walletResponseSchema>;

// --- V2PositionResponse (nested) ---
export const v2PositionResponseSchema = z.object({
  symbol: z.string(),
  qty: z.string(),
  avgCost: z.string(),
  currentPrice: z.string(),
  marketValue: z.string(),
  unrealizedPnl: z.string(),
  pnlPercent: z.string(),
  securityType: z.string(),
});
export type V2PositionResponse = z.infer<typeof v2PositionResponseSchema>;

// --- V2WalletResponse ---
export const v2WalletResponseSchema = z.object({
  cashBalance: z.string(),
  initialCapital: z.string(),
  totalValue: z.string(),
  returnPercent: z.string(),
  tradingMode: z.string(),
  positions: z.array(v2PositionResponseSchema),
});
export type V2WalletResponse = z.infer<typeof v2WalletResponseSchema>;

// --- StagedOperationResponse ---
export const stagedOperationResponseSchema = z.object({
  action: z.string(),
  ticker: z.string(),
  shares: z.string().nullable(),
  amount: z.string().nullable(),
  price: z.string().nullable(),
});
export type StagedOperationResponse = z.infer<typeof stagedOperationResponseSchema>;

// --- V2OperationResponse (nested) ---
export const v2OperationResponseSchema = z.object({
  action: z.string(),
  symbol: z.string(),
  qty: z.string(),
  amount: z.string(),
  price: z.string(),
});
export type V2OperationResponse = z.infer<typeof v2OperationResponseSchema>;

// --- V2CommitResponse ---
export const v2CommitResponseSchema = z.object({
  hash: z.string(),
  parentHash: z.string(),
  message: z.string(),
  timestamp: z.string(),
  operations: z.array(v2OperationResponseSchema),
  results: z.array(z.record(z.string(), z.unknown())),
});
export type V2CommitResponse = z.infer<typeof v2CommitResponseSchema>;

// --- V2StagedResponse ---
export const v2StagedResponseSchema = z.object({
  operations: z.array(v2OperationResponseSchema),
  count: z.number().int(),
});
export type V2StagedResponse = z.infer<typeof v2StagedResponseSchema>;

// --- V2SearchResponse ---
export const v2SearchResponseSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  securityType: z.string(),
  exchange: z.string(),
});
export type V2SearchResponse = z.infer<typeof v2SearchResponseSchema>;

// --- TradingResponse ---
export const tradingResponseSchema = z.object({
  message: z.string(),
});
export type TradingResponse = z.infer<typeof tradingResponseSchema>;

// --- MarketHoursResponse ---
export const marketHoursResponseSchema = z.object({
  isOpen: z.boolean(),
  nextOpen: z.string().datetime().nullable(),
  nextClose: z.string().datetime().nullable(),
  timestamp: z.string().datetime(),
});
export type MarketHoursResponse = z.infer<typeof marketHoursResponseSchema>;

// ── Trading Engine DTOs ────────────────────────────────────────────────────
// Zod schemas for trading engine types, mirroring the Java records in
// com.example.finsentinel.service.trading.engine.*

// --- OrderRequest ---
export const orderRequestSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  qty: z.string(),
  type: z.enum(['MARKET', 'LIMIT']),
  limitPrice: z.string().optional(),
  timeInForce: z.enum(['DAY', 'GTC', 'IOC']).default('DAY'),
});
export type OrderRequest = z.infer<typeof orderRequestSchema>;

// --- OrderResult ---
export const orderResultSchema = z.object({
  orderId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  qty: z.string(),
  filledQty: z.string(),
  avgPrice: z.string(),
  status: z.enum(['NEW', 'FILLED', 'PARTIALLY_FILLED', 'CANCELLED', 'REJECTED']),
  createdAt: z.string(),
});
export type OrderResult = z.infer<typeof orderResultSchema>;

// --- AccountInfo ---
export const accountInfoSchema = z.object({
  equity: z.string(),
  cash: z.string(),
  buyingPower: z.string(),
  unrealizedPnl: z.string(),
  dayTradeCount: z.number().int().optional(),
});
export type AccountInfo = z.infer<typeof accountInfoSchema>;

// --- PositionInfo ---
export const positionInfoSchema = z.object({
  symbol: z.string(),
  qty: z.string(),
  avgEntryPrice: z.string(),
  currentPrice: z.string(),
  unrealizedPnl: z.string(),
  side: z.enum(['LONG', 'SHORT']),
});
export type PositionInfo = z.infer<typeof positionInfoSchema>;

// --- MarketClock ---
export const marketClockSchema = z.object({
  isOpen: z.boolean(),
  nextOpen: z.string(),
  nextClose: z.string(),
  timestamp: z.string(),
});
export type MarketClock = z.infer<typeof marketClockSchema>;
