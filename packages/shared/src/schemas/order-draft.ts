import { z } from 'zod';
import { decimalString } from './decimal-string';

export const portfolioIntentSchema = z.enum([
  'OPEN',
  'ADD',
  'REDUCE',
  'CLOSE',
  'HEDGE',
  'REBALANCE',
]);
export type PortfolioIntent = z.infer<typeof portfolioIntentSchema>;

export const orderDraftAssetTypeSchema = z.enum(['EQUITY', 'ETF', 'CRYPTO', 'OPTION', 'FUTURE']);
export type OrderDraftAssetType = z.infer<typeof orderDraftAssetTypeSchema>;

export const orderDraftSideSchema = z.enum(['BUY', 'SELL']);
export type OrderDraftSide = z.infer<typeof orderDraftSideSchema>;

export const orderDraftQuantitySchema = z.object({
  mode: z.enum(['SHARES', 'NOTIONAL_USD', 'PERCENT_NAV', 'CONTRACTS']),
  value: z.number().positive(),
});
export type OrderDraftQuantity = z.infer<typeof orderDraftQuantitySchema>;

export const orderDraftOrderTypeSchema = z.enum(['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT']);

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

// ---------------------------------------------------------------------------
// Decimal-money M1 schema (decimal-string boundary)
//
// New schema shape required by the decimal-money migration PRD
// (`docs/exec-plans/2026-04-24-decimal-money-migration.md`). Replaces the
// `quantity` object + `limitPrice`/`stopPrice` numbers with the decimal-string
// boundary fields `qty` / `amount` / `percentNav` / `price`. Exactly one of
// qty / amount / percentNav must be set per draft. `price` is independently
// optional (limit price).
//
// The legacy `orderDraftSchema` above is intentionally untouched in M1 — only
// the new schema enforces the decimal-string boundary. M2/M3/M4 (broker
// arithmetic, unified service, broker adapters) will migrate consumers to
// this schema.
// ---------------------------------------------------------------------------
export const decimalOrderDraftSchema = z
  .object({
    symbol: z.string().min(1).max(40),
    side: orderDraftSideSchema,
    qty: decimalString.optional(),
    amount: decimalString.optional(),
    percentNav: decimalString.optional(),
    price: decimalString.optional(),
  })
  .refine(
    (o) => [o.qty, o.amount, o.percentNav].filter(Boolean).length === 1,
    { message: 'exactly one of qty / amount / percentNav must be set' },
  );
export type DecimalOrderDraft = z.infer<typeof decimalOrderDraftSchema>;
