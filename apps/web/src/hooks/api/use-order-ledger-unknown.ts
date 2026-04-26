'use client';

import useSWR from 'swr';
import { tradingLedgerApi } from '../../api/trading';

/**
 * Stable SWR cache key for the operator-pending UNKNOWN ledger list.
 * Tuple form keeps it collision-free against `useOrderLedger` and other
 * domains. Exposed on `useOrderLedgerUnknown.key` so callers (e.g. the
 * Acknowledge modal) can `mutate(useOrderLedgerUnknown.key)` after a
 * successful ack.
 */
const key = ['trading', 'ledger-unknown'] as const;

/**
 * SWR-backed hook for the UNKNOWN_REQUIRES_OPERATOR_REVIEW pending-ack
 * list (M4 prereq (2) operator surface). Polls every 30s — these rows
 * change much less often than EXECUTING ones, so the lighter cadence
 * keeps the trading page quiet.
 */
export function useOrderLedgerUnknown() {
  return useSWR(key, () => tradingLedgerApi.unknown(), { refreshInterval: 30_000 });
}

useOrderLedgerUnknown.key = key;
