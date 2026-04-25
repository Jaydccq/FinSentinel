'use client';

import { useEffect, useState } from 'react';
import {
  analysisRunsApi,
  type AnalysisRunResponse,
  type ExecutionReviewLedgerResponse,
} from '../../api/analysis-runs';
import { analysisApprovalsApi } from '../../api/analysis-approvals';
import { ExecutionLedgerPanel } from './ExecutionLedgerPanel';

interface ApprovalRow {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  requestedPayload: Record<string, unknown>;
  requestedAt: string;
}

export interface HumanApprovalRailProps {
  run: AnalysisRunResponse | null;
  onResolved: () => void;
}

export function HumanApprovalRail({ run, onResolved }: HumanApprovalRailProps) {
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [ledgers, setLedgers] = useState<ExecutionReviewLedgerResponse[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!run) {
      setApprovals([]);
      setLedgers([]);
      return;
    }
    let cancelled = false;
    // Approvals are only meaningful when the run is waiting for approval.
    if (run.status === 'WAITING_APPROVAL') {
      analysisRunsApi
        .listApprovals(run.id)
        .then((rows) => {
          if (!cancelled) setApprovals(rows as ApprovalRow[]);
        })
        .catch(() => {});
    } else {
      setApprovals([]);
    }
    // Ledgers are meaningful any time the run has progressed past approval.
    analysisRunsApi
      .getLedger(run.id)
      .then((rows) => {
        if (!cancelled) setLedgers(rows);
      })
      .catch(() => setLedgers([]));
    return () => {
      cancelled = true;
    };
  }, [run]);

  if (!run) return null;

  const pending = approvals.find((a) => a.status === 'PENDING');

  // Don't render anything if there's nothing to show.
  if (!pending && ledgers.length === 0) return null;

  const resolve = async (decision: 'APPROVE' | 'REJECT') => {
    if (!pending) return;
    setBusy(true);
    try {
      await analysisApprovalsApi.resolve(pending.id, decision, note.trim() || undefined);
      setNote('');
      onResolved();
    } finally {
      setBusy(false);
    }
  };

  const commit = async (ledgerId: string) => {
    await analysisRunsApi.commitLedger(ledgerId);
    onResolved();
  };

  const dispatch = async (ledgerId: string) => {
    await analysisRunsApi.dispatchLedger(ledgerId);
    onResolved();
  };

  return (
    <aside className="surface-panel rounded p-4 sticky top-4 space-y-3">
      <h2 className="text-base font-semibold">Control Rail</h2>
      {pending ? (
        <>
          <p className="text-xs text-slate-400">Run is paused. Review the order drafts below.</p>
          <pre className="text-xs bg-slate-950/70 p-2 rounded overflow-auto max-h-[200px]">
            {JSON.stringify(pending.requestedPayload, null, 2)}
          </pre>
          <label className="block">
            <span className="field-label">Note (optional)</span>
            <textarea
              rows={2}
              className="field-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              className="btn-primary px-4 py-2 text-sm flex-1"
              disabled={busy}
              onClick={() => resolve('APPROVE')}
            >
              Approve Execution
            </button>
            <button
              className="btn-secondary px-4 py-2 text-sm flex-1"
              disabled={busy}
              onClick={() => resolve('REJECT')}
            >
              Reject
            </button>
          </div>
        </>
      ) : null}
      {ledgers.map((ledger) => (
        <ExecutionLedgerPanel
          key={ledger.id}
          ledger={ledger}
          onCommit={() => commit(ledger.id)}
          onDispatch={() => dispatch(ledger.id)}
        />
      ))}
    </aside>
  );
}
