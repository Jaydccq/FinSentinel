import { z } from 'zod';

export const portfolioIntentSchema = z.enum([
  'OPEN',
  'ADD',
  'REDUCE',
  'CLOSE',
  'HEDGE',
  'REBALANCE',
]);
export type PortfolioIntent = z.infer<typeof portfolioIntentSchema>;

export const orderDraftAssetTypeSchema = z.enum([
  'EQUITY',
  'ETF',
  'CRYPTO',
  'OPTION',
  'FUTURE',
]);
export type OrderDraftAssetType = z.infer<typeof orderDraftAssetTypeSchema>;

export const orderDraftSideSchema = z.enum(['BUY', 'SELL']);
export type OrderDraftSide = z.infer<typeof orderDraftSideSchema>;

export const orderDraftQuantitySchema = z.object({
  mode: z.enum(['SHARES', 'NOTIONAL_USD', 'PERCENT_NAV', 'CONTRACTS']),
  value: z.number().positive(),
});
export type OrderDraftQuantity = z.infer<typeof orderDraftQuantitySchema>;

export const orderDraftOrderTypeSchema = z.enum([
  'MARKET',
  'LIMIT',
  'STOP',
  'STOP_LIMIT',
]);

export const orderDraftTimeInForceSchema = z.enum(['DAY', 'GTC', 'IOC', 'FOK']);

export const orderDraftBrokerConstraintsSchema = z.object({
  allowFractional: z.boolean(),
  extendedHours: z.boolean(),
});

export const orderDraftSchema = z.object({
  draftId: z.string().uuid(),
  portfolioIntent: portfolioIntentSchema,
  assetType: orderDraftAssetTypeSchema,
  symbol: z.string().min(1).max(40),
  side: orderDraftSideSchema,
  quantity: orderDraftQuantitySchema,
  orderType: orderDraftOrderTypeSchema,
  limitPrice: z.number().positive().nullable(),
  stopPrice: z.number().positive().nullable(),
  timeInForce: orderDraftTimeInForceSchema,
  thesisRef: z.string().min(1),
  riskRef: z.string().min(1),
  maxSlippageBps: z.number().int().min(0).max(10_000),
  maxPositionPercent: z.number().min(0).max(100),
  brokerConstraints: orderDraftBrokerConstraintsSchema,
  approvalRequired: z.literal(true),
  warnings: z.array(z.string()),
});
export type OrderDraft = z.infer<typeof orderDraftSchema>;

export const orderDraftsPayloadSchema = z.object({
  orderDrafts: z.array(orderDraftSchema),
});
export type OrderDraftsPayload = z.infer<typeof orderDraftsPayloadSchema>;
