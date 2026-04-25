'use client';

import { useOrderLedger } from '../../hooks/api/use-order-ledger';
import { OrderLedgerCard } from './OrderLedgerCard';

/**
 * "Recent Orders" — read-only ledger surface for the Trading page.
 *
 * Reads from the SWR-backed `useOrderLedger` hook (poll interval 10s)
 * and renders each row through `OrderLedgerCard`. Phase 1: empty state
 * + 3-row loading skeleton + up to 25 rows newest-first. Operator
 * actions (retry / acknowledge) ship disabled until item 3 M4 lands.
 */
export function RecentOrdersSection() {
  const { data, error, isLoading } = useOrderLedger(25);

  return (
    <section
      data-testid="recent-orders-section"
      className="surface-panel rounded p-3 md:p-4 space-y-2"
    >
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recent Orders</h2>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded border border-slate-700/40 bg-slate-800/30"
            />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <div className="text-xs text-red-300">
          Failed to load order ledger. Will retry automatically.
        </div>
      )}

      {!isLoading && !error && data != null && data.length === 0 && (
        <div className="text-xs text-slate-400">No orders yet.</div>
      )}

      {!isLoading && !error && data != null && data.length > 0 && (
        <div className="space-y-2">
          {data.map((row) => (
            <OrderLedgerCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}
