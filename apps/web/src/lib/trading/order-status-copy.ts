// TODO i18n — copy is English-only; future i18n pass should source these
// strings from the translation catalog rather than this module.
import type { OrderLedgerStatus } from '@finsentinel/shared';

export interface OrderStatusCopy {
  label: string;
  /**
   * Tailwind class string applied to the badge container. Phase-1 colors
   * are utility-class defaults; designer review may iterate.
   */
  colorClass: string;
  iconHint: 'pending' | 'spin' | 'check' | 'half' | 'cross' | 'alert';
}

/**
 * Single source of truth mapping each `OrderLedgerStatus` value to its
 * user-facing copy and visual treatment. Mirrors the canonical SQL CHECK
 * constraint on `order_ledger.status` (V23 + V24) and the Drizzle enum at
 * `packages/db/src/schema/order-ledger.ts`.
 */
export const ORDER_STATUS_COPY: Record<OrderLedgerStatus, OrderStatusCopy> = {
  STAGED: {
    label: 'Staged',
    colorClass: 'bg-gray-100 text-gray-700',
    iconHint: 'pending',
  },
  COMMITTED: {
    label: 'Committed',
    colorClass: 'bg-gray-200 text-gray-800',
    iconHint: 'pending',
  },
  EXECUTING: {
    label: 'Executing',
    colorClass: 'bg-blue-100 text-blue-700',
    iconHint: 'spin',
  },
  EXECUTED: {
    label: 'Executed',
    colorClass: 'bg-green-100 text-green-700',
    iconHint: 'check',
  },
  PARTIALLY_FAILED: {
    label: 'Partially filled',
    colorClass: 'bg-amber-100 text-amber-800',
    iconHint: 'half',
  },
  FAILED: {
    label: 'Failed',
    colorClass: 'bg-red-100 text-red-700',
    iconHint: 'cross',
  },
  CANCELLED: {
    label: 'Cancelled',
    colorClass: 'bg-gray-100 text-gray-500',
    iconHint: 'cross',
  },
  UNKNOWN_REQUIRES_OPERATOR_REVIEW: {
    label: 'Unknown — review',
    colorClass: 'bg-red-200 text-red-900 ring-1 ring-red-400',
    iconHint: 'alert',
  },
};

/**
 * Safe fallback for status values the UI doesn't recognize yet (e.g. the
 * backend introduces a new enum value before the web bundle catches up).
 * Renders something clearly degraded rather than crashing.
 */
const FALLBACK: OrderStatusCopy = {
  label: 'Unknown',
  colorClass: 'bg-gray-100 text-gray-600',
  iconHint: 'alert',
};

export function orderStatusCopy(status: string): OrderStatusCopy {
  return (ORDER_STATUS_COPY as Record<string, OrderStatusCopy>)[status] ?? FALLBACK;
}
