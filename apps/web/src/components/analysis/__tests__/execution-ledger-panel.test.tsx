import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionReviewLedgerResponse } from '../../../api/analysis-runs';
import { ExecutionLedgerPanel } from '../ExecutionLedgerPanel';

function makeLedger(
  overrides: Partial<ExecutionReviewLedgerResponse> = {},
): ExecutionReviewLedgerResponse {
  return {
    id: 'ledger-1',
    runId: 'run-1',
    approvalId: 'approval-1',
    status: 'APPROVED',
    orderDraftRefs: ['artifact-1'],
    stagedOperationRefs: [],
    commitHash: null,
    executionResultRef: null,
    rejectionNote: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ExecutionLedgerPanel', () => {
  it('renders status and draft refs', () => {
    render(
      <ExecutionLedgerPanel
        ledger={makeLedger({ status: 'STAGED', stagedOperationRefs: ['BUY:AAPL', 'SELL:MSFT'] })}
        onCommit={async () => {}}
        onDispatch={async () => {}}
      />,
    );
    expect(screen.getByText(/STAGED/)).toBeTruthy();
    expect(screen.getByText(/BUY:AAPL/)).toBeTruthy();
  });

  it('shows a Create Commit button only when status is APPROVED and no commit hash yet', () => {
    render(
      <ExecutionLedgerPanel
        ledger={makeLedger({ status: 'APPROVED', commitHash: null })}
        onCommit={async () => {}}
        onDispatch={async () => {}}
      />,
    );
    expect(screen.getByText(/Create Commit/i)).toBeTruthy();
  });

  it('shows a Dispatch button only when commitHash is present and status != EXECUTED/FAILED', () => {
    render(
      <ExecutionLedgerPanel
        ledger={makeLedger({ status: 'COMMITTED', commitHash: 'abc123def' })}
        onCommit={async () => {}}
        onDispatch={async () => {}}
      />,
    );
    expect(screen.getByText(/Dispatch/i)).toBeTruthy();
  });

  it('hides action buttons when terminal', () => {
    const { container } = render(
      <ExecutionLedgerPanel
        ledger={makeLedger({ status: 'EXECUTED', commitHash: 'abc' })}
        onCommit={async () => {}}
        onDispatch={async () => {}}
      />,
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders rejection note when REJECTED', () => {
    render(
      <ExecutionLedgerPanel
        ledger={makeLedger({ status: 'REJECTED', rejectionNote: 'Too risky' })}
        onCommit={async () => {}}
        onDispatch={async () => {}}
      />,
    );
    expect(screen.getByText(/Too risky/)).toBeTruthy();
  });

  it('invokes onCommit when Create Commit is clicked', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <ExecutionLedgerPanel
        ledger={makeLedger({ status: 'APPROVED' })}
        onCommit={onCommit}
        onDispatch={async () => {}}
      />,
    );
    fireEvent.click(screen.getByText(/Create Commit/i));
    expect(onCommit).toHaveBeenCalled();
  });
});
