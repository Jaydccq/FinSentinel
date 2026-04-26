'use client';

import { useState } from 'react';

export interface AcknowledgeUnknownModalProps {
  /** UUID of the order_ledger row being acknowledged. Shown short-form. */
  ledgerId: string;
  /** Controls modal visibility. Parent owns the open state. */
  isOpen: boolean;
  /** Called when the operator dismisses or after a successful ack. */
  onClose: () => void;
  /**
   * Async confirmation handler. The modal awaits this — no optimistic UI.
   * Throwing surfaces an inline error and keeps the modal open so the
   * operator can retry.
   */
  onConfirm: (note: string) => Promise<void>;
}

/**
 * Modal that captures an operator note before acknowledging an
 * UNKNOWN_REQUIRES_OPERATOR_REVIEW ledger row.
 *
 * Design constraints (per the M4 prereq (2) plan):
 * - The note is required at three layers (Zod min(1) on the request, the
 *   service rejects whitespace, and this modal disables submit on empty).
 * - The submit awaits the server response — no optimistic mutation. The
 *   operator should see the actual server-confirmed row before the modal
 *   closes.
 * - On success, the parent handles SWR cache invalidation; this component
 *   only resets local state and calls `onClose`.
 */
export function AcknowledgeUnknownModal({
  ledgerId,
  isOpen,
  onClose,
  onConfirm,
}: AcknowledgeUnknownModalProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const trimmed = note.trim();
  const isEmpty = trimmed.length === 0;

  const submit = async () => {
    if (isEmpty) {
      setError('Note is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      setNote('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Acknowledge failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-labelledby="ack-unknown-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-[480px] max-w-[90vw] rounded bg-slate-900 p-4 shadow-lg ring-1 ring-slate-700/40">
        <h2 id="ack-unknown-title" className="text-sm font-semibold text-slate-100 mb-2">
          Acknowledge Unknown Order
        </h2>
        <p className="text-xs text-slate-300 mb-3">
          Order <code className="text-slate-200">{ledgerId.slice(0, 8)}…</code> is in
          UNKNOWN_REQUIRES_OPERATOR_REVIEW state. Describe what you investigated. The note becomes
          part of the audit trail.
        </p>
        <textarea
          aria-label="Acknowledgement note"
          className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100 placeholder-slate-500"
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Confirmed with broker that fill landed; updating ledger metadata only."
          maxLength={1000}
          disabled={submitting}
        />
        <div className="text-xs text-slate-500 mt-1">{note.length}/1000</div>
        {error != null && (
          <div role="alert" className="text-red-400 text-xs mt-2">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            className="rounded px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400"
            onClick={submit}
            disabled={submitting || isEmpty}
          >
            {submitting ? 'Saving…' : 'Acknowledge'}
          </button>
        </div>
      </div>
    </div>
  );
}
