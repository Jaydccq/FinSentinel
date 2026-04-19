import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionPrepTeamService } from '../teams/execution-prep-team.service';
import { AgentEventType } from '@finsentinel/shared';

const validDraft = {
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
};

describe('ExecutionPrepTeamService.execute', () => {
  let roleExec: { run: ReturnType<typeof vi.fn> };
  let runs: { getForUser: ReturnType<typeof vi.fn> };
  let checkpoints: {
    findByStage: ReturnType<typeof vi.fn>;
    commitStage: ReturnType<typeof vi.fn>;
    writeOrderDrafts: ReturnType<typeof vi.fn>;
  };
  let validator: { validate: ReturnType<typeof vi.fn> };
  let approvals: { request: ReturnType<typeof vi.fn> };
  let fabric: { assemble: ReturnType<typeof vi.fn>; toPromptReady: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: ExecutionPrepTeamService;

  beforeEach(() => {
    roleExec = {
      run: vi
        .fn()
        .mockResolvedValueOnce({
          roleKey: 'TRADE_PLANNER',
          structured: {
            summary: 's', thesis: 't', risks: [], openQuestions: [],
            citations: [], confidence: 0.8,
          },
          rawMarkdown: 'plan',
          durationMs: 60,
          toolCallCount: 2,
        })
        .mockResolvedValueOnce({
          roleKey: 'EXECUTION_DRAFT_BUILDER',
          structured: {
            summary: 's', thesis: 't', risks: [], openQuestions: [],
            citations: [], confidence: 0.9,
            orderDrafts: [validDraft],
          },
          rawMarkdown: '```json\n{"orderDrafts":[...]}\n```',
          durationMs: 80,
          toolCallCount: 4,
        }),
    };
    runs = {
      getForUser: vi.fn().mockResolvedValue({
        id: 'r1',
        inputSnapshotJson: { prompt: 'x' },
      }),
    };
    checkpoints = {
      findByStage: vi.fn().mockResolvedValue({ structuredOutputJson: { summary: 'risk' } }),
      commitStage: vi.fn().mockResolvedValue(undefined),
      writeOrderDrafts: vi.fn().mockResolvedValue({ id: 'art-1' }),
    };
    validator = { validate: vi.fn().mockImplementation((v) => v) };
    approvals = { request: vi.fn().mockResolvedValue({ id: 'appr-1' }) };
    fabric = {
      assemble: vi.fn().mockResolvedValue({
        longTermPreferenceContext: { summary: '', sourceIds: [] },
        midTermStrategyContext: { summary: '', sourceIds: [] },
        shortTermSessionContext: { summary: '', sourceIds: [] },
        retrievalContext: { summary: '', sourceIds: [] },
      }),
      toPromptReady: vi.fn().mockReturnValue('ctx'),
    };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new ExecutionPrepTeamService(
      roleExec as never,
      runs as never,
      checkpoints as never,
      validator as never,
      approvals as never,
      fabric as never,
      events as never,
    );
  });

  it('validates drafts, writes ORDER_DRAFTS artifact, opens approval, commits stage', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    expect(validator.validate).toHaveBeenCalledWith({ orderDrafts: [validDraft] });
    expect(checkpoints.writeOrderDrafts).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'r1',
        payload: { orderDrafts: [validDraft] },
      }),
    );
    expect(approvals.request).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r1', userId: 'u1' }),
    );
    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({ stageKey: 'EXECUTION_PREP' }),
    );
    const eventTypes = events.append.mock.calls.map((c) => c[3]);
    expect(eventTypes).toContain(AgentEventType.EXECUTION_PREP_TEAM_STARTED);
    expect(eventTypes).toContain(AgentEventType.EXECUTION_PREP_TEAM_COMPLETED);
  });

  it('throws when the builder produces no orderDrafts', async () => {
    roleExec.run = vi
      .fn()
      .mockResolvedValueOnce({
        roleKey: 'TRADE_PLANNER',
        structured: { summary: '', thesis: '', risks: [], openQuestions: [], citations: [], confidence: 0 },
        rawMarkdown: '',
      })
      .mockResolvedValueOnce({
        roleKey: 'EXECUTION_DRAFT_BUILDER',
        structured: { summary: '', thesis: '', risks: [], openQuestions: [], citations: [], confidence: 0 },
        rawMarkdown: '',
      });
    svc = new ExecutionPrepTeamService(
      roleExec as never,
      runs as never,
      checkpoints as never,
      validator as never,
      approvals as never,
      fabric as never,
      events as never,
    );
    await expect(svc.execute({ runId: 'r1', userId: 'u1' })).rejects.toThrow(/orderDrafts/);
  });

  it('passes runId into context fabric assembly', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    expect(fabric.assemble).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', runId: 'r1', prompt: 'x' }),
    );
  });

  it('writes roleSummaries for TRADE_PLANNER and EXECUTION_DRAFT_BUILDER into structuredOutput', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const commitArg = checkpoints.commitStage.mock.calls[0]?.[0];
    const summaries = commitArg?.structuredOutput?.roleSummaries;
    expect(summaries?.map((s: { roleKey: string }) => s.roleKey)).toEqual([
      'TRADE_PLANNER',
      'EXECUTION_DRAFT_BUILDER',
    ]);
  });
});
