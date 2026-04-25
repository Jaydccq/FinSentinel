import type { OrderLedgerRowResponse } from '@finsentinel/shared';
import { OrderStatusBadge } from './OrderStatusBadge';

/**
 * Render-side action affordance for a ledger row. Phase 1 ships a
 * disabled button for the two states that need operator intervention,
 * with a tooltip that says when the action becomes live. The wiring
 * lands with item 3 M4.
 *
 * Status values not listed here intentionally have no action button —
 * EXECUTED / EXECUTING / STAGED / COMMITTED / CANCELLED don't expose
 * an operator action in this phase.
 */
function actionForStatus(status: string): { label: string } | null {
  switch (status) {
    case 'FAILED':
      return { label: 'Retry' };
    case 'UNKNOWN_REQUIRES_OPERATOR_REVIEW':
      return { label: 'Acknowledge' };
    default:
      return null;
  }
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
 * Single-row presentation of an order_ledger entry. Phase 1 is read-only
 * — action buttons render disabled with a tooltip noting that wiring
 * lands in phase 2 alongside the operator-action backend (item 3 M4).
 */
export function OrderLedgerCard({ row, filledQty }: OrderLedgerCardProps) {
  const action = actionForStatus(row.status);
  const fillDisplay = formatFillRatio(row.qty, filledQty ?? row.qty);

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
          <OrderStatusBadge status={row.status} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          {fillDisplay != null && <span>{fillDisplay}</span>}
          {row.price != null && <span>@ {row.price}</span>}
          <span>{new Date(row.updatedAt).toLocaleString()}</span>
        </div>
        {row.errorReason != null && row.errorReason.length > 0 && (
          <div className="text-xs text-red-300">{row.errorReason}</div>
        )}
      </div>
      {action != null && (
        <button
          type="button"
          disabled
          title="Coming in phase 2"
          className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 opacity-50"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
