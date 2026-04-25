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
        return { returning: async () => [{ ...v, id: 'appr-1' }] };
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
        return { where: () => ({ returning: async () => [{ ...v, id: 'appr-1' }] }) };
      },
    }),
  };
}

const runsStub = {
  markCompleted: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
};
const checkpointsStub = { writeExecutionPayload: vi.fn().mockResolvedValue({ id: 'art-exec' }) };
const mapperStub = {
  toUnifiedStageRequest: vi.fn().mockReturnValue({ action: 'BUY', symbol: 'AAPL', qty: '100' }),
};
const tradingStub = {
  stage: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue({ hash: 'h', count: 1 }),
  execute: vi.fn().mockResolvedValue({ report: 'ok', results: [] }),
};
const defaultAutoDispatchFlag = { enabled: false };
const ledgerMock = {
  createDraft: vi.fn().mockResolvedValue({ id: 'ledger-1' }),
  markApproved: vi.fn().mockResolvedValue(undefined),
  markRejected: vi.fn().mockResolvedValue(undefined),
  markCommitted: vi.fn().mockResolvedValue(undefined),
  markDispatched: vi.fn().mockResolvedValue(undefined),
  markFailed: vi.fn().mockResolvedValue(undefined),
  listForRun: vi.fn().mockResolvedValue([]),
  getByApprovalId: vi.fn().mockResolvedValue({ id: 'ledger-1', approvalId: 'appr-1' }),
};

describe('AnalysisApprovalService', () => {
  let events: { append: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    events = { append: vi.fn().mockResolvedValue({ id: 'evt-1' }) };
    vi.clearAllMocks();
  });

  it('request() creates a PENDING approval and emits EXECUTION_APPROVAL_REQUIRED', async () => {
    const db = makeDb();
    const svc = new AnalysisApprovalService(
      db as never,
      events as never,
      runsStub as never,
      checkpointsStub as never,
      mapperStub as never,
      tradingStub as never,
      defaultAutoDispatchFlag,
      undefined,
      undefined,
      ledgerMock as never,
    );
    const row = await svc.request({
      userId: 'u1',
      runId: 'r1',
      payload,
      orderDraftArtifactId: 'artifact-id-X',
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
    expect(ledgerMock.createDraft).toHaveBeenCalledWith({
      runId: 'r1',
      approvalId: 'appr-1',
      orderDraftRefs: ['artifact-id-X'],
    });
  });

  it('request() rejects payloads that fail OrderDraft schema', async () => {
    const db = makeDb();
    const svc = new AnalysisApprovalService(
      db as never,
      events as never,
      runsStub as never,
      checkpointsStub as never,
      mapperStub as never,
      tradingStub as never,
      defaultAutoDispatchFlag,
    );
    await expect(
      svc.request({
        userId: 'u1',
        runId: 'r1',
        payload: { orderDrafts: [{}] } as never,
        orderDraftArtifactId: 'art-x',
      }),
    ).rejects.toThrow();
  });

  it('resolve(APPROVE) flips status and emits EXECUTION_APPROVED', async () => {
    const db = makeDb({
      id: 'appr-1',
      runId: 'r1',
      status: 'PENDING',
      requestedPayloadJson: payload,
    });
    const svc = new AnalysisApprovalService(
      db as never,
      events as never,
      runsStub as never,
      checkpointsStub as never,
      mapperStub as never,
      tradingStub as never,
      defaultAutoDispatchFlag,
      undefined,
      undefined,
      ledgerMock as never,
    );
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
    expect(ledgerMock.markApproved).toHaveBeenCalledWith({ approvalId: 'appr-1' });
  });

  it('resolve() on non-PENDING row throws', async () => {
    const db = makeDb({
      id: 'appr-1',
      runId: 'r1',
      status: 'APPROVED',
      requestedPayloadJson: payload,
    });
    const svc = new AnalysisApprovalService(
      db as never,
      events as never,
      runsStub as never,
      checkpointsStub as never,
      mapperStub as never,
      tradingStub as never,
      defaultAutoDispatchFlag,
    );
    await expect(
      svc.resolve({ userId: 'u1', approvalId: 'appr-1', decision: 'APPROVE' }),
    ).rejects.toThrow(/already resolved/i);
  });

  it('marks the ledger rejected when approval is rejected', async () => {
    const db = makeDb({
      id: 'appr-1',
      runId: 'r1',
      status: 'PENDING',
      requestedPayloadJson: payload,
    });
    const svc = new AnalysisApprovalService(
      db as never,
      events as never,
      runsStub as never,
      checkpointsStub as never,
      mapperStub as never,
      tradingStub as never,
      defaultAutoDispatchFlag,
      undefined,
      undefined,
      ledgerMock as never,
    );
    await svc.resolve({
      userId: 'u1',
      approvalId: 'appr-1',
      decision: 'REJECT',
      note: 'Too much sizing risk',
    });
    expect(ledgerMock.markRejected).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'appr-1', note: 'Too much sizing risk' }),
    );
  });
});

describe('AnalysisApprovalService.resolve(APPROVE) follow-through', () => {
  it('writes EXECUTION_PAYLOAD artifact and marks run COMPLETED', async () => {
    const db = makeDb({
      id: 'appr-1',
      runId: 'r1',
      status: 'PENDING',
      requestedPayloadJson: payload,
    });
    const events = { append: vi.fn().mockResolvedValue({}) };
    const runsLocal = {
      markCompleted: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const checkpointsLocal = {
      writeExecutionPayload: vi.fn().mockResolvedValue({ id: 'art-exec' }),
    };
    const mapperLocal = {
      toUnifiedStageRequest: vi.fn().mockReturnValue({ action: 'BUY', symbol: 'AAPL', qty: '100' }),
    };
    const svc = new AnalysisApprovalService(
      db as never,
      events as never,
      runsLocal as never,
      checkpointsLocal as never,
      mapperLocal as never,
      tradingStub as never,
      defaultAutoDispatchFlag,
    );
    await svc.resolve({ userId: 'u1', approvalId: 'appr-1', decision: 'APPROVE' });
    expect(checkpointsLocal.writeExecutionPayload).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r1' }),
    );
    expect(runsLocal.markCompleted).toHaveBeenCalledWith('u1', 'r1');
  });

  it('materializes run outputs when context journal and assembler are available', async () => {
    const db = makeDb({
      id: 'appr-1',
      runId: 'r1',
      status: 'PENDING',
      requestedPayloadJson: payload,
    });
    const events = { append: vi.fn().mockResolvedValue({}) };
    const runsLocal = {
      markCompleted: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      listStagesForRun: vi.fn().mockResolvedValue([
        {
          stageKey: 'RISK',
          humanReportMarkdown: 'risk ok',
          structuredOutputJson: {
            portfolioDecision: 'BUY',
            allocationGuidance: { notes: 'scale in', targets: [] },
            riskLimits: { maxDrawdownPct: 8, stopLossTriggers: [] },
            alertTriggers: [],
            confidence: 0.72,
          },
        },
      ]),
      completeWithOutputs: vi.fn().mockResolvedValue(undefined),
    };
    const checkpointsLocal = {
      writeExecutionPayload: vi.fn().mockResolvedValue({ id: 'art-exec' }),
    };
    const mapperLocal = {
      toUnifiedStageRequest: vi.fn().mockReturnValue({ action: 'BUY', symbol: 'AAPL', qty: '100' }),
    };
    const contextJournal = {
      getRunContext: vi.fn().mockResolvedValue({
        longTermPreferenceContext: { summary: '', sourceIds: [] },
        midTermStrategyContext: { summary: '', sourceIds: [] },
        shortTermSessionContext: { summary: '', sourceIds: [] },
        retrievalContext: { summary: '', sourceIds: [] },
      }),
    };
    const assembler = {
      build: vi.fn().mockReturnValue({
        decisionObject: null,
        finalReportMarkdown: '# Final',
      }),
    };
    const svc = new AnalysisApprovalService(
      db as never,
      events as never,
      runsLocal as never,
      checkpointsLocal as never,
      mapperLocal as never,
      tradingStub as never,
      defaultAutoDispatchFlag,
      contextJournal as never,
      assembler as never,
    );

    await svc.resolve({ userId: 'u1', approvalId: 'appr-1', decision: 'APPROVE' });

    expect(runsLocal.markCompleted).not.toHaveBeenCalled();
    expect(runsLocal.completeWithOutputs).toHaveBeenCalledWith({
      userId: 'u1',
      runId: 'r1',
      sharedContext: expect.any(Object),
      decisionObject: null,
      finalReportMarkdown: '# Final',
    });
  });
});

describe('AnalysisApprovalService.resolve(APPROVE) with auto-dispatch', () => {
  it('stages/commits/executes via UnifiedTradingService when flag enabled', async () => {
    const db = makeDb({
      id: 'appr-1',
      runId: 'r1',
      status: 'PENDING',
      requestedPayloadJson: payload,
    });
    const events = { append: vi.fn().mockResolvedValue({}) };
    const runsStub = { markCompleted: vi.fn().mockResolvedValue(undefined), cancel: vi.fn() };
    const checkpointsStub = { writeExecutionPayload: vi.fn().mockResolvedValue({ id: 'art' }) };
    const mapperStub = {
      toUnifiedStageRequest: vi.fn().mockReturnValue({ action: 'BUY', symbol: 'AAPL', qty: '100' }),
    };
    const tradingStub = {
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue({ hash: 'h', count: 1 }),
      execute: vi.fn().mockResolvedValue({ report: 'ok', results: [] }),
    };
    const svc = new AnalysisApprovalService(
      db as never,
      events as never,
      runsStub as never,
      checkpointsStub as never,
      mapperStub as never,
      tradingStub as never,
      { enabled: true },
    );
    await svc.resolve({ userId: 'u1', approvalId: 'appr-1', decision: 'APPROVE' });
    expect(tradingStub.stage).toHaveBeenCalled();
    expect(tradingStub.commit).toHaveBeenCalledWith(
      'u1',
      expect.stringContaining('auto:run'),
      expect.anything(),
    );
    expect(tradingStub.execute).toHaveBeenCalledWith('u1');
  });

  it('marks the ledger COMMITTED and DISPATCHED when auto-dispatch succeeds', async () => {
    const db = makeDb({
      id: 'appr-1',
      runId: 'r1',
      status: 'PENDING',
      requestedPayloadJson: payload,
    });
    const events = { append: vi.fn().mockResolvedValue({}) };
    const runsLocal = { markCompleted: vi.fn().mockResolvedValue(undefined), cancel: vi.fn() };
    const checkpointsLocal = { writeExecutionPayload: vi.fn().mockResolvedValue({ id: 'art' }) };
    const mapperLocal = {
      toUnifiedStageRequest: vi.fn().mockReturnValue({ action: 'BUY', symbol: 'AAPL', qty: '100' }),
    };
    const mockTrading = {
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue({ hash: 'abc123', count: 1 }),
      execute: vi.fn().mockResolvedValue({ fills: [{ orderId: 'f-1' }] }),
    };
    const svc = new AnalysisApprovalService(
      db as never,
      events as never,
      runsLocal as never,
      checkpointsLocal as never,
      mapperLocal as never,
      mockTrading as never,
      { enabled: true },
      undefined,
      undefined,
      ledgerMock as never,
    );

    await svc.resolve({ userId: 'u1', approvalId: 'appr-1', decision: 'APPROVE' });

    expect(mockTrading.commit).toHaveBeenCalledWith(
      'u1',
      expect.stringContaining('auto:run r1'),
      expect.objectContaining({ runId: 'r1', ledgerId: expect.any(String) }),
    );
    expect(ledgerMock.markCommitted).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'appr-1', commitHash: 'abc123' }),
    );
    expect(ledgerMock.markDispatched).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'appr-1', executionResultRef: 'abc123' }),
    );
  });

  it('marks the ledger FAILED when auto-dispatch throws', async () => {
    const db = makeDb({
      id: 'appr-1',
      runId: 'r1',
      status: 'PENDING',
      requestedPayloadJson: payload,
    });
    const events = { append: vi.fn().mockResolvedValue({}) };
    const runsLocal = { markCompleted: vi.fn().mockResolvedValue(undefined), cancel: vi.fn() };
    const checkpointsLocal = { writeExecutionPayload: vi.fn().mockResolvedValue({ id: 'art' }) };
    const mapperLocal = {
      toUnifiedStageRequest: vi.fn().mockReturnValue({ action: 'BUY', symbol: 'AAPL', qty: '100' }),
    };
    const mockTrading = {
      stage: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockRejectedValue(new Error('redis down')),
      execute: vi.fn(),
    };
    const svc = new AnalysisApprovalService(
      db as never,
      events as never,
      runsLocal as never,
      checkpointsLocal as never,
      mapperLocal as never,
      mockTrading as never,
      { enabled: true },
      undefined,
      undefined,
      ledgerMock as never,
    );

    await svc.resolve({ userId: 'u1', approvalId: 'appr-1', decision: 'APPROVE' });

    expect(ledgerMock.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: 'appr-1',
        note: expect.stringContaining('redis down'),
      }),
    );
  });
});
