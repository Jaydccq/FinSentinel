import { BadRequestException, NotFoundException } from '@nestjs/common';
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

  /** Build a chainable select mock that returns `rows` for the first call and `secondRows` for the second call. */
  function makeSelectSequence(firstRows: unknown[], secondRows: unknown[]) {
    let callCount = 0;
    const makeChain = (rows: unknown[]) => {
      const limit = vi.fn().mockResolvedValue(rows);
      const where = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where });
      return { from, where, limit };
    };
    return vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain(firstRows);
      return makeChain(secondRows);
    });
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

  it('getByApprovalId queries by approvalId and returns the first row', async () => {
    const db = makeDb();
    const limitMock = vi.fn().mockResolvedValue([{ id: 'ledger-1' }]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock });
    const svc = new ExecutionReviewLedgerService(db as never);
    const row = await svc.getByApprovalId('approval-1');
    expect(row?.id).toBe('ledger-1');
  });

  describe('commitManual', () => {
    const userId = 'user-1';
    const ledgerId = 'ledger-1';
    const runId = 'run-1';

    it('commits the staged trading ops and marks the ledger COMMITTED when state is APPROVED', async () => {
      const db = makeDb();
      // First select: ledger row in APPROVED state
      // Second select: run row owned by userId
      db.select = makeSelectSequence(
        [{ id: ledgerId, runId, approvalId: 'approval-1', status: 'APPROVED', commitHash: null }],
        [{ id: runId, userId }],
      );
      const tradingMock = { commit: vi.fn().mockResolvedValue({ hash: 'c1', count: 1 }) };
      const svc = new ExecutionReviewLedgerService(db as never, tradingMock as never);
      await svc.commitManual(userId, ledgerId);
      expect(tradingMock.commit).toHaveBeenCalledWith(
        userId,
        expect.stringContaining(runId),
        expect.objectContaining({ runId, ledgerId }),
      );
      expect(db.setUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'COMMITTED', commitHash: 'c1' }),
      );
    });

    it('throws BadRequestException when the ledger is not APPROVED', async () => {
      const db = makeDb();
      db.select = makeSelectSequence(
        [{ id: ledgerId, runId, approvalId: 'approval-1', status: 'DRAFTED', commitHash: null }],
        [{ id: runId, userId }],
      );
      const tradingMock = { commit: vi.fn() };
      const svc = new ExecutionReviewLedgerService(db as never, tradingMock as never);
      await expect(svc.commitManual(userId, ledgerId)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the ledger does not exist or belongs to another user', async () => {
      const db = makeDb();
      // Empty first select → ledger not found
      db.select = makeSelectSequence([], []);
      const tradingMock = { commit: vi.fn() };
      const svc = new ExecutionReviewLedgerService(db as never, tradingMock as never);
      await expect(svc.commitManual(userId, ledgerId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('dispatchManual', () => {
    const userId = 'user-1';
    const ledgerId = 'ledger-1';
    const runId = 'run-1';

    it('executes and marks the ledger EXECUTED when state is COMMITTED', async () => {
      const db = makeDb();
      db.select = makeSelectSequence(
        [{ id: ledgerId, runId, approvalId: 'approval-1', status: 'COMMITTED', commitHash: 'c1' }],
        [{ id: runId, userId }],
      );
      const tradingMock = { execute: vi.fn().mockResolvedValue({ report: 'ok' }) };
      const svc = new ExecutionReviewLedgerService(db as never, tradingMock as never);
      await svc.dispatchManual(userId, ledgerId);
      expect(tradingMock.execute).toHaveBeenCalledWith(userId);
      expect(db.setUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'EXECUTED' }),
      );
    });

    it('throws BadRequestException when the ledger is not COMMITTED', async () => {
      const db = makeDb();
      db.select = makeSelectSequence(
        [{ id: ledgerId, runId, approvalId: 'approval-1', status: 'DRAFTED', commitHash: null }],
        [{ id: runId, userId }],
      );
      const tradingMock = { execute: vi.fn() };
      const svc = new ExecutionReviewLedgerService(db as never, tradingMock as never);
      await expect(svc.dispatchManual(userId, ledgerId)).rejects.toThrow(BadRequestException);
    });
  });
});
