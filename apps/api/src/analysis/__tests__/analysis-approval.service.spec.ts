import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisApprovalService } from '../analysis-approval.service';
import { AgentEventAggregateType, AgentEventType } from '@finsentinel/shared';

const payload = {
  orderDrafts: [
    {
      draftId: '11111111-1111-1111-1111-111111111111',
      portfolioIntent: 'OPEN',
      assetType: 'EQUITY',
      symbol: 'AAPL',
      side: 'BUY',
      quantity: { mode: 'SHARES', value: 100 },
      orderType: 'MARKET',
      limitPrice: null,
      stopPrice: null,
      timeInForce: 'DAY',
      thesisRef: 'artifact-t',
      riskRef: 'artifact-r',
      maxSlippageBps: 50,
      maxPositionPercent: 5,
      brokerConstraints: { allowFractional: false, extendedHours: false },
      approvalRequired: true,
      warnings: [],
    },
  ],
};

function makeDb(approvalRow: Record<string, unknown> | null = null) {
  const state = {
    lastInsert: undefined as Record<string, unknown> | undefined,
    lastUpdateSet: undefined as Record<string, unknown> | undefined,
    row: approvalRow,
  };
  return {
    state,
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.lastInsert = v;
        return { returning: async () => [{ id: 'appr-1', ...v }] };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (state.row ? [state.row] : []) }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        state.lastUpdateSet = v;
        return { where: () => ({ returning: async () => [{ id: 'appr-1', ...v }] }) };
      },
    }),
  };
}

describe('AnalysisApprovalService', () => {
  let events: { append: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    events = { append: vi.fn().mockResolvedValue({ id: 'evt-1' }) };
  });

  it('request() creates a PENDING approval and emits EXECUTION_APPROVAL_REQUIRED', async () => {
    const db = makeDb();
    const svc = new AnalysisApprovalService(db as never, events as never);
    const row = await svc.request({
      userId: 'u1',
      runId: 'r1',
      payload,
    });
    expect(row.id).toBe('appr-1');
    expect(db.state.lastInsert).toMatchObject({
      runId: 'r1',
      approvalType: 'EXECUTION_APPROVAL',
      status: 'PENDING',
    });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_APPROVAL,
      'appr-1',
      AgentEventType.EXECUTION_APPROVAL_REQUIRED,
      expect.any(Object),
      expect.any(String),
    );
  });

  it('request() rejects payloads that fail OrderDraft schema', async () => {
    const db = makeDb();
    const svc = new AnalysisApprovalService(db as never, events as never);
    await expect(
      svc.request({ userId: 'u1', runId: 'r1', payload: { orderDrafts: [{}] } as never }),
    ).rejects.toThrow();
  });

  it('resolve(APPROVE) flips status and emits EXECUTION_APPROVED', async () => {
    const db = makeDb({ id: 'appr-1', runId: 'r1', status: 'PENDING', requestedPayloadJson: payload });
    const svc = new AnalysisApprovalService(db as never, events as never);
    await svc.resolve({ userId: 'u1', approvalId: 'appr-1', decision: 'APPROVE' });
    expect(db.state.lastUpdateSet).toMatchObject({ status: 'APPROVED' });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_APPROVAL,
      'appr-1',
      AgentEventType.EXECUTION_APPROVED,
      expect.any(Object),
      null,
    );
  });

  it('resolve() on non-PENDING row throws', async () => {
    const db = makeDb({ id: 'appr-1', runId: 'r1', status: 'APPROVED', requestedPayloadJson: payload });
    const svc = new AnalysisApprovalService(db as never, events as never);
    await expect(
      svc.resolve({ userId: 'u1', approvalId: 'appr-1', decision: 'APPROVE' }),
    ).rejects.toThrow(/already resolved/i);
  });
});
