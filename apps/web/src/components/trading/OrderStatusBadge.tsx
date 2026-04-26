import { orderStatusCopy } from '../../lib/trading/order-status-copy';

/**
 * Small inline badge that translates an order_ledger status string into a
 * stable label + color treatment. Renders a fallback for unknown enum
 * values so a backend addition never breaks the screen.
 *
 * The `data-status` attribute is part of the QA contract — selectors in
 * E2E / RTL tests pin to it instead of the (translatable) label text.
 *
 * `acknowledged` (V25): when an UNKNOWN_REQUIRES_OPERATOR_REVIEW row has
 * been acknowledged by an operator, the badge appends `(ack'd)` so the
 * row reads "Unknown — review (ack'd)". The status enum itself is
 * unchanged on purpose; ack is metadata.
 */
export function OrderStatusBadge({
  status,
  acknowledged = false,
}: {
  status: string;
  acknowledged?: boolean;
}) {
  const copy = orderStatusCopy(status);
  const showAckSuffix = acknowledged && status === 'UNKNOWN_REQUIRES_OPERATOR_REVIEW';
  return (
    <span
      role="status"
      data-status={status}
      data-acknowledged={showAckSuffix ? 'true' : undefined}
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${copy.colorClass}`}
    >
      {copy.label}
      {showAckSuffix && <span className="ml-1 text-[10px] opacity-80">(ack&apos;d)</span>}
    </span>
  );
}
