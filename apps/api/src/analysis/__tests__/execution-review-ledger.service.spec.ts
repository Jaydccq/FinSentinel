import { describe, expect, it, vi } from 'vitest';
import { ExecutionReviewLedgerService } from '../execution-review-ledger.service';

describe('ExecutionReviewLedgerService', () => {
  function makeDb() {
    const returning = vi.fn();
    const values = vi.fn().mockReturnValue({ returning });
    const whereUpdate = vi.fn();
    const setUpdate = vi.fn().mockReturnValue({ where: whereUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const update = vi.fn().mockReturnValue({ set: setUpdate });
    const select = vi.fn();
    return { insert, update, select, returning, values, setUpdate, whereUpdate };
  }

  it('createDraft inserts a DRAFTED row bound to run + approval + draft refs', async () => {
    const db = makeDb();
    db.returning.mockResolvedValue([{ id: 'ledger-1' }]);
    const svc = new ExecutionReviewLedgerService(db as never);
    const row = await svc.createDraft({
      runId: '22222222-2222-2222-2222-222222222222',
      approvalId: '33333333-3333-3333-3333-333333333333',
      orderDraftRefs: ['artifact-1'],
    });
    expect(row.id).toBe('ledger-1');
    const insertArgs = db.values.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArgs.status).toBe('DRAFTED');
    expect(insertArgs.orderDraftRefs).toEqual(['artifact-1']);
    expect(insertArgs.runId).toBe('22222222-2222-2222-2222-222222222222');
    expect(insertArgs.approvalId).toBe('33333333-3333-3333-3333-333333333333');
  });

  it('markApproved updates the row keyed by approvalId', async () => {
    const db = makeDb();
    const svc = new ExecutionReviewLedgerService(db as never);
    await svc.markApproved({ approvalId: 'approval-1' });
    expect(db.setUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'APPROVED' }));
  });

  it('markRejected persists the rejection note', async () => {
    const db = makeDb();
    const svc = new ExecutionReviewLedgerService(db as never);
    await svc.markRejected({ approvalId: 'approval-1', note: 'too much sizing risk' });
    const setPayload = db.setUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(setPayload.status).toBe('REJECTED');
    expect(setPayload.rejectionNote).toBe('too much sizing risk');
  });
});
