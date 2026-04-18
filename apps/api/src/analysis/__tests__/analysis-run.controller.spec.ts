import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisRunController } from '../analysis-run.controller';

describe('AnalysisRunController', () => {
  let runs: {
    createQueued: ReturnType<typeof vi.fn>;
    getForUser: ReturnType<typeof vi.fn>;
    listByUser: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    listStagesForRun: ReturnType<typeof vi.fn>;
    listArtifactsForRun: ReturnType<typeof vi.fn>;
    listApprovalsForRun: ReturnType<typeof vi.fn>;
  };
  let producer: { enqueuePreflight: ReturnType<typeof vi.fn> };
  let contextJournal: {
    getRunContext: ReturnType<typeof vi.fn>;
    getStageInput: ReturnType<typeof vi.fn>;
  };
  let ctrl: AnalysisRunController;
  // CurrentUserPayload uses userId + username (not sub + email)
  const user = { userId: 'u1', username: 'u@x.com' } as never;

  beforeEach(() => {
    runs = {
      createQueued: vi.fn().mockResolvedValue({ id: 'r1', userId: 'u1', status: 'QUEUED' }),
      getForUser: vi.fn(),
      listByUser: vi.fn().mockResolvedValue([]),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      listStagesForRun: vi.fn().mockResolvedValue([]),
      listArtifactsForRun: vi.fn().mockResolvedValue([]),
      listApprovalsForRun: vi.fn().mockResolvedValue([]),
    };
    producer = { enqueuePreflight: vi.fn().mockResolvedValue(undefined) };
    contextJournal = {
      getRunContext: vi.fn().mockResolvedValue({
        longTermPreferenceContext: { summary: '', sourceIds: [] },
        midTermStrategyContext: { summary: '', sourceIds: [] },
        shortTermSessionContext: { summary: 'session summary', sourceIds: ['ctx-1'] },
        retrievalContext: { summary: '', sourceIds: [] },
      }),
      getStageInput: vi.fn().mockResolvedValue({
        contextEntryIds: ['ctx-1'],
        priorStageKeys: ['INTELLIGENCE'],
        evidenceEntryIds: ['rag-1'],
        promptHash: 'hash-1',
        tokenBudget: 12000,
        truncationApplied: false,
      }),
    };
    ctrl = new AnalysisRunController(runs as never, producer as never, contextJournal as never);
  });

  it('POST /analysis/runs creates a run and enqueues preflight', async () => {
    const res = await ctrl.create(
      { prompt: 'Analyze AAPL', sourceMode: 'WORKSPACE' },
      user,
    );
    expect(runs.createQueued).toHaveBeenCalledWith('u1', expect.any(Object));
    expect(producer.enqueuePreflight).toHaveBeenCalledWith({ runId: 'r1', userId: 'u1' });
    expect(res.id).toBe('r1');
  });

  it('GET /analysis/runs/:id 404s when not owned', async () => {
    runs.getForUser.mockResolvedValue(null);
    await expect(ctrl.getOne('r1', user)).rejects.toThrow(/not found/i);
  });

  it('POST /analysis/runs/:id/pause delegates to service', async () => {
    await ctrl.pause('r1', user);
    expect(runs.pause).toHaveBeenCalledWith('u1', 'r1');
  });

  it('GET :id/stages 404s when run not owned', async () => {
    runs.getForUser.mockResolvedValue(null);
    await expect(ctrl.listStages('r1', user)).rejects.toThrow(/not found/i);
  });

  it('GET :id/stages delegates to listStagesForRun', async () => {
    runs.getForUser.mockResolvedValue({ id: 'r1', userId: 'u1', status: 'RUNNING' });
    await ctrl.listStages('r1', user);
    expect(runs.listStagesForRun).toHaveBeenCalledWith('r1');
  });

  it('GET :id/artifacts 404s when run not owned', async () => {
    runs.getForUser.mockResolvedValue(null);
    await expect(ctrl.listArtifacts('r1', user)).rejects.toThrow(/not found/i);
  });

  it('GET :id/artifacts delegates to listArtifactsForRun', async () => {
    runs.getForUser.mockResolvedValue({ id: 'r1', userId: 'u1', status: 'RUNNING' });
    await ctrl.listArtifacts('r1', user);
    expect(runs.listArtifactsForRun).toHaveBeenCalledWith('r1');
  });

  it('GET :id/approvals 404s when run not owned', async () => {
    runs.getForUser.mockResolvedValue(null);
    await expect(ctrl.listApprovals('r1', user)).rejects.toThrow(/not found/i);
  });

  it('GET :id/approvals delegates to listApprovalsForRun', async () => {
    runs.getForUser.mockResolvedValue({ id: 'r1', userId: 'u1', status: 'RUNNING' });
    await ctrl.listApprovals('r1', user);
    expect(runs.listApprovalsForRun).toHaveBeenCalledWith('r1');
  });

  it('GET /analysis/runs/:id/context returns the materialized context snapshot', async () => {
    runs.getForUser.mockResolvedValue({ id: 'r1', userId: 'u1', status: 'RUNNING' });

    const result = await ctrl.getContext('r1', user);

    expect(contextJournal.getRunContext).toHaveBeenCalledWith('u1', 'r1');
    expect(result.shortTermSessionContext.sourceIds.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /analysis/runs/:id/context 404s when not owned', async () => {
    runs.getForUser.mockResolvedValue(null);

    await expect(ctrl.getContext('r1', user)).rejects.toThrow(/not found/i);
  });

  it('GET /analysis/runs/:id/stages/:stageKey/input returns stage input snapshot', async () => {
    runs.getForUser.mockResolvedValue({ id: 'r1', userId: 'u1', status: 'RUNNING' });

    const result = await ctrl.getStageInput('r1', 'THESIS', user);

    expect(contextJournal.getStageInput).toHaveBeenCalledWith('u1', 'r1', 'THESIS');
    expect(result?.contextEntryIds).toEqual(['ctx-1']);
  });
});
