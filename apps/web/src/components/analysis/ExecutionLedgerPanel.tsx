'use client';

import type { ExecutionReviewLedgerResponse } from '../../api/analysis-runs';

export interface ExecutionLedgerPanelProps {
  ledger: ExecutionReviewLedgerResponse;
  onCommit: () => Promise<void>;
  onDispatch: () => Promise<void>;
}

export function ExecutionLedgerPanel({ ledger, onCommit, onDispatch }: ExecutionLedgerPanelProps) {
  const showCommit = ledger.status === 'APPROVED' && !ledger.commitHash;
  const showDispatch =
    !!ledger.commitHash && ledger.status !== 'EXECUTED' && ledger.status !== 'FAILED';

  return (
    <section className="surface-panel rounded p-4 space-y-3">
      <h2 className="text-base font-semibold">Execution Ledger</h2>
      <p className="text-xs text-slate-400">
        Status: <b>{ledger.status}</b>
      </p>
      {ledger.commitHash ? (
        <p className="text-xs text-slate-400 font-mono">
          commit {ledger.commitHash.slice(0, 10)}&hellip;
        </p>
      ) : null}
      {ledger.stagedOperationRefs.length > 0 ? (
        <ul className="text-sm space-y-1">
          {ledger.stagedOperationRefs.map((op) => (
            <li key={op}>{op}</li>
          ))}
        </ul>
      ) : null}
      {ledger.rejectionNote ? <p className="text-xs text-red-300">{ledger.rejectionNote}</p> : null}
      {showCommit ? (
        <button className="btn-secondary px-3 py-1 text-xs" onClick={onCommit}>
          Create Commit
        </button>
      ) : null}
      {showDispatch ? (
        <button className="btn-primary px-3 py-1 text-xs" onClick={onDispatch}>
          Dispatch
        </button>
      ) : null}
    </section>
  );
}
