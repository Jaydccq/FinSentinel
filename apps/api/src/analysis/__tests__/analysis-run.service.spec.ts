import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisRunService } from '../analysis-run.service';
import { AgentEventAggregateType, AgentEventType } from '@finsentinel/shared';

describe('AnalysisRunService', () => {
  let db: ReturnType<typeof makeFakeDb>;
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: AnalysisRunService;

  beforeEach(() => {
    db = makeFakeDb();
    events = { append: vi.fn().mockResolvedValue({ id: 'evt-1' }) };
    svc = new AnalysisRunService(db as never, events as never);
  });

  it('createQueued persists a QUEUED run and emits RUN_QUEUED', async () => {
    db.__insertReturns([{ id: 'run-1', userId: 'u1', status: 'QUEUED' }]);
    const run = await svc.createQueued('u1', {
      prompt: 'analyze AAPL',
      sourceMode: 'WORKSPACE',
    });
    expect(run.id).toBe('run-1');
    expect(db.__lastInsert).toMatchObject({ userId: 'u1', status: 'QUEUED' });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_RUN,
      'run-1',
      AgentEventType.RUN_QUEUED,
      expect.any(Object),
      expect.any(String),
    );
  });

  it('markRunning transitions status and emits RUN_STARTED', async () => {
    db.__updateReturns([{ id: 'run-1', status: 'RUNNING' }]);
    await svc.markRunning('u1', 'run-1');
    expect(db.__lastUpdate.set).toMatchObject({ status: 'RUNNING' });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_RUN,
      'run-1',
      AgentEventType.RUN_STARTED,
      expect.any(Object),
      null,
    );
  });

  it('completeWithOutputs persists materialized outputs and emits RUN_COMPLETED', async () => {
    await svc.completeWithOutputs({
      userId: 'u1',
      runId: 'run-1',
      sharedContext: null,
      decisionObject: null,
      finalReportMarkdown: '# Final',
    });

    expect(db.__lastUpdate.set).toMatchObject({
      status: 'COMPLETED',
      sharedContextJson: null,
      decisionObjectJson: null,
      finalReportMarkdown: '# Final',
    });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_RUN,
      'run-1',
      AgentEventType.RUN_COMPLETED,
      {},
      null,
    );
  });

  it('pause rejects when status is not RUNNING', async () => {
    db.__selectReturns([{ id: 'run-1', userId: 'u1', status: 'COMPLETED' }]);
    await expect(svc.pause('u1', 'run-1')).rejects.toThrow(/cannot pause/i);
  });

  it('pause transitions RUNNING -> PAUSED and emits RUN_PAUSED', async () => {
    db.__selectReturns([{ id: 'run-1', userId: 'u1', status: 'RUNNING' }]);
    db.__updateReturns([{ id: 'run-1', status: 'PAUSED' }]);
    await svc.pause('u1', 'run-1');
    expect(db.__lastUpdate.set).toMatchObject({ status: 'PAUSED' });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_RUN,
      'run-1',
      AgentEventType.RUN_PAUSED,
      expect.any(Object),
      null,
    );
  });

  it('retryStage rejects active runs', async () => {
    db.__selectReturns([{ id: 'run-1', userId: 'u1', status: 'RUNNING' }]);
    await expect(svc.retryStage('u1', 'run-1', 'RISK')).rejects.toThrow(/cannot retry/i);
  });

  it('retryStage transitions FAILED -> RUNNING at the requested stage', async () => {
    db.__selectReturns([{ id: 'run-1', userId: 'u1', status: 'FAILED' }]);
    db.__updateReturns([{ id: 'run-1', status: 'RUNNING', currentStageKey: 'RISK' }]);

    await svc.retryStage('u1', 'run-1', 'RISK');

    expect(db.__lastUpdate.set).toMatchObject({
      status: 'RUNNING',
      currentStageKey: 'RISK',
    });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_RUN,
      'run-1',
      AgentEventType.RUN_RESUMED,
      { retry: true, stageKey: 'RISK' },
      null,
    );
  });

  it('getForUser scopes by userId', async () => {
    db.__selectReturns([{ id: 'run-1', userId: 'u1' }]);
    const run = await svc.getForUser('u1', 'run-1');
    expect(run?.id).toBe('run-1');
    expect(db.__lastWhereDescriptor).toBeDefined();
  });

  it('persists preset in inputSnapshotJson', async () => {
    db.__insertReturns([{ id: 'run-2', userId: 'u1', status: 'QUEUED' }]);
    await svc.createQueued('u1', {
      prompt: 'hi',
      sourceMode: 'WORKSPACE',
      preset: 'FAST_RISK_CHECK',
    } as never);
    expect((db.__lastInsert as Record<string, unknown>).inputSnapshotJson).toMatchObject({
      preset: 'FAST_RISK_CHECK',
    });
  });
});

function makeFakeDb() {
  let selectQueue: unknown[] = [];
  let insertQueue: unknown[] = [];
  let updateQueue: unknown[] = [];
  const fake = {
    __lastInsert: undefined as unknown,
    __lastUpdate: { set: undefined as unknown },
    __lastWhereDescriptor: undefined as unknown,
    __selectReturns(rows: unknown[]) { selectQueue = rows; },
    __insertReturns(rows: unknown[]) { insertQueue = rows; },
    __updateReturns(rows: unknown[]) { updateQueue = rows; },
    select: () => ({
      from: () => ({
        where: (expr: unknown) => ({
          limit: async () => {
            fake.__lastWhereDescriptor = expr;
            return selectQueue;
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        fake.__lastInsert = v;
        return { returning: async () => insertQueue };
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        fake.__lastUpdate.set = v;
        return {
          where: () => ({ returning: async () => updateQueue }),
        };
      },
    }),
  };
  return fake;
}
