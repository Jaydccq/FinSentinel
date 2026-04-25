import { orderStatusCopy } from '../../lib/trading/order-status-copy';

/**
 * Small inline badge that translates an order_ledger status string into a
 * stable label + color treatment. Renders a fallback for unknown enum
 * values so a backend addition never breaks the screen.
 *
 * The `data-status` attribute is part of the QA contract — selectors in
 * E2E / RTL tests pin to it instead of the (translatable) label text.
 */
export function OrderStatusBadge({ status }: { status: string }) {
  const copy = orderStatusCopy(status);
  return (
    <span
      role="status"
      data-status={status}
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${copy.colorClass}`}
    >
      {copy.label}
    </span>
  );
}
