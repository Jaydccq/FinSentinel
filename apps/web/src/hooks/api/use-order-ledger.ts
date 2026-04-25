'use client';

import useSWR from 'swr';
import { tradingLedgerApi } from '../../api/trading';

/**
 * Stable SWR cache key for the order-ledger list. Tuple form keeps it
 * collision-free against other domains, and the `limit` slot lets callers
 * vary the page size without colliding with each other.
 */
export function orderLedgerKey(limit: number) {
  return ['trading', 'ledger', limit] as const;
}

/**
 * SWR-backed hook for the read-only order ledger surface (phase-1
 * trading-status UI). Polls every 10s while the page is mounted so
 * EXECUTING rows progress visibly without a manual refresh.
 *
 * Phase-2 will replace polling with the live event stream once the
 * operator-action backend lands (item 3 M4).
 */
export function useOrderLedger(limit = 25) {
  return useSWR(
    orderLedgerKey(limit),
    () => tradingLedgerApi.list(limit),
    { refreshInterval: 10_000 },
  );
}

useOrderLedger.key = orderLedgerKey;
