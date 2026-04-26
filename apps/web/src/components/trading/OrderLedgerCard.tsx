'use client';

import { useState } from 'react';
import { mutate } from 'swr';
import type { OrderLedgerRowResponse } from '@finsentinel/shared';
import { tradingLedgerApi } from '../../api/trading';
import { useOrderLedgerUnknown } from '../../hooks/api/use-order-ledger-unknown';
import { OrderStatusBadge } from './OrderStatusBadge';
import { AcknowledgeUnknownModal } from './AcknowledgeUnknownModal';

/**
 * Render-side action affordance for a ledger row.
 *
 * - FAILED still ships disabled (Retry wires in a later phase).
 * - UNKNOWN_REQUIRES_OPERATOR_REVIEW now opens the AcknowledgeUnknownModal
 *   when the row has not yet been acknowledged. Once `acknowledgedAt` is
 *   set, no button renders — the row shows an "acknowledged at <time>"
 *   note instead.
 */
function isAcknowledgeable(row: OrderLedgerRowResponse): boolean {
  return row.status === 'UNKNOWN_REQUIRES_OPERATOR_REVIEW' && row.acknowledgedAt == null;
}

function formatFillRatio(qty: string | null, filledQty: string | null | undefined): string | null {
  if (qty == null) return null;
  if (filledQty == null) return qty;
  return `${filledQty} / ${qty}`;
}

export interface OrderLedgerCardProps {
  row: OrderLedgerRowResponse;
  /**
   * Optional fill quantity. Most rows in phase 1 are written terminal
   * (EXECUTED / FAILED) so the ledger doesn't yet split qty vs filled —
   * callers can pass a separate value if they have one.
   */
  filledQty?: string | null;
}

/**
 * Single-row presentation of an order_ledger entry. UNKNOWN rows expose an
 * Acknowledge action that opens a modal capturing an audit note. FAILED
 * rows still render a disabled Retry placeholder until that flow lands.
 */
export function OrderLedgerCard({ row, filledQty }: OrderLedgerCardProps) {
  const [isAckOpen, setIsAckOpen] = useState(false);
  const fillDisplay = formatFillRatio(row.qty, filledQty ?? row.qty);
  const acknowledged = row.acknowledgedAt != null;

  const onConfirmAck = async (note: string) => {
    await tradingLedgerApi.acknowledge(row.id, { note });
    // Invalidate both SWR caches:
    // - useOrderLedgerUnknown: the row drops off the pending list.
    // - useOrderLedger (any limit slot): the row re-renders with the
    //   ack suffix in the Recent Orders feed.
    await Promise.all([
      mutate(useOrderLedgerUnknown.key),
      mutate(
        (key) => Array.isArray(key) && key[0] === 'trading' && key[1] === 'ledger',
        undefined,
        { revalidate: true },
      ),
    ]);
  };

  const ackable = isAcknowledgeable(row);
  const showRetryStub = row.status === 'FAILED';

  return (
    <div
      data-testid="order-ledger-card"
      className="flex items-center gap-3 rounded border border-slate-700/40 bg-slate-900/30 px-3 py-2 text-sm"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.symbol}</span>
          <span className="text-xs uppercase text-slate-400">{row.side}</span>
          <span className="text-xs text-slate-500">{row.broker}</span>
          <OrderStatusBadge status={row.status} acknowledged={acknowledged} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          {fillDisplay != null && <span>{fillDisplay}</span>}
          {row.price != null && <span>@ {row.price}</span>}
          <span>{new Date(row.updatedAt).toLocaleString()}</span>
        </div>
        {row.errorReason != null && row.errorReason.length > 0 && (
          <div className="text-xs text-red-300">{row.errorReason}</div>
        )}
        {acknowledged && row.acknowledgedAt != null && (
          <div data-testid="ack-meta" className="text-xs text-slate-400">
            acknowledged {new Date(row.acknowledgedAt).toLocaleString()}
            {row.acknowledgedBy != null && (
              <> by {row.acknowledgedBy.slice(0, 8)}…</>
            )}
            {row.acknowledgementNote != null && row.acknowledgementNote.length > 0 && (
              <> — “{row.acknowledgementNote}”</>
            )}
          </div>
        )}
      </div>
      {ackable && (
        <button
          type="button"
          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
          onClick={() => setIsAckOpen(true)}
        >
          Acknowledge
        </button>
      )}
      {showRetryStub && (
        <button
          type="button"
          disabled
          title="Coming in phase 2"
          className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 opacity-50"
        >
          Retry
        </button>
      )}
      <AcknowledgeUnknownModal
        ledgerId={row.id}
        isOpen={isAckOpen}
        onClose={() => setIsAckOpen(false)}
        onConfirm={onConfirmAck}
      />
    </div>
  );
}
