import { z } from 'zod';

/**
 * Mirror of the SQL CHECK constraint on `order_ledger.status` (V23 + V24).
 * Keep this list in sync with `packages/db/src/schema/order-ledger.ts`
 * `ORDER_LEDGER_STATUSES`. The web client treats this as the source of
 * truth for state-aware copy and color mapping.
 */
export const orderLedgerStatusSchema = z.enum([
  'STAGED',
  'COMMITTED',
  'EXECUTING',
  'EXECUTED',
  'PARTIALLY_FAILED',
  'FAILED',
  'CANCELLED',
  'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
]);
export type OrderLedgerStatus = z.infer<typeof orderLedgerStatusSchema>;

/**
 * Wire-format row returned by `GET /trading/ledger`. Decimal columns are
 * strings (decimal-money convention) and may be null when the broker did
 * not report a value.
 *
 * V25 adds `acknowledged*` operator-action metadata. The fields are nullable
 * because the vast majority of rows (everything that isn't an
 * UNKNOWN_REQUIRES_OPERATOR_REVIEW that has been ack'd) leaves them unset.
 */
export const orderLedgerRowResponseSchema = z.object({
  id: z.string(),
  commitHash: z.string(),
  status: orderLedgerStatusSchema,
  symbol: z.string(),
  side: z.string(),
  qty: z.string().nullable(),
  amount: z.string().nullable(),
  price: z.string().nullable(),
  broker: z.string(),
  brokerOrderId: z.string().nullable(),
  errorReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // V25 — operator acknowledgement metadata for UNKNOWN_REQUIRES_OPERATOR_REVIEW.
  acknowledgedAt: z.string().nullable(),
  acknowledgedBy: z.string().nullable(),
  acknowledgementNote: z.string().nullable(),
});
export type OrderLedgerRowResponse = z.infer<typeof orderLedgerRowResponseSchema>;

export const orderLedgerListResponseSchema = z.array(orderLedgerRowResponseSchema);
export type OrderLedgerListResponse = z.infer<typeof orderLedgerListResponseSchema>;

/**
 * Body for `POST /trading/ledger/:id/acknowledge`. The note is required —
 * an empty ack provides no audit value. Trim happens server-side; the
 * frontend modal additionally disables submit on whitespace-only input.
 */
export const acknowledgeLedgerRequestSchema = z.object({
  note: z.string().min(1).max(1000),
});
export type AcknowledgeLedgerRequest = z.infer<typeof acknowledgeLedgerRequestSchema>;
