import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntelligenceTeamService } from '../teams/intelligence-team.service';
import { AgentEventType, strategyArchivePayloadSchema } from '@finsentinel/shared';

describe('IntelligenceTeamService.execute', () => {
  let roleExec: { run: ReturnType<typeof vi.fn> };
  let runs: { getForUser: ReturnType<typeof vi.fn> };
  let checkpoints: { commitStage: ReturnType<typeof vi.fn>; writeStrategyArchive: ReturnType<typeof vi.fn> };
  let strategyEvidence: { buildArchive: ReturnType<typeof vi.fn> };
  let fabric: { assemble: ReturnType<typeof vi.fn>; toPromptReady: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: IntelligenceTeamService;

  beforeEach(() => {
    roleExec = {
      run: vi.fn().mockResolvedValue({
        roleKey: 'MARKET_ANALYST',
        structured: {
          summary: 's',
          thesis: 't',
          risks: [],
          openQuestions: [],
          citations: [],
          confidence: 0.8,
        },
        rawMarkdown: '# r',
      }),
    };
    runs = {
      getForUser: vi.fn().mockResolvedValue({
        id: 'r1',
        inputSnapshotJson: { prompt: 'analyze AAPL', ticker: 'AAPL' },
      }),
    };
    strategyEvidence = {
      buildArchive: vi.fn().mockResolvedValue(
        strategyArchivePayloadSchema.parse({
          status: 'EVALUATED',
          ticker: 'AAPL',
          generatedAt: '2026-04-19T00:00:00.000Z',
          bars: {
            requestedDays: 260,
            receivedBars: 260,
            source: 'market-data.service',
          },
          evaluations: [],
          selectedTemplateKey: null,
          summary: {
            enterLongCount: 0,
            blockedCount: 0,
            warnings: ['no issues'],
            recommendedNextStep: null,
          },
        }),
      ),
    };
    checkpoints = {
      commitStage: vi.fn().mockResolvedValue(undefined),
      writeStrategyArchive: vi.fn().mockResolvedValue(undefined),
    };
    fabric = {
      assemble: vi.fn().mockResolvedValue({
        longTermPreferenceContext: { summary: 'a', sourceIds: [] },
        midTermStrategyContext: { summary: 'b', sourceIds: [] },
        shortTermSessionContext: { summary: 'c', sourceIds: [] },
        retrievalContext: { summary: 'd', sourceIds: [] },
      }),
      toPromptReady: vi.fn().mockReturnValue('ctx-text'),
    };
    events = { append: vi.fn().mockResolvedValue({}) };
    svc = new IntelligenceTeamService(
      roleExec as never,
      runs as never,
      strategyEvidence as never,
      checkpoints as never,
      fabric as never,
      events as never,
    );
  });

  it('emits INTELLIGENCE_TEAM_STARTED, runs 4 analysts, commits checkpoint, emits COMPLETED', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const eventTypes = events.append.mock.calls.map((c) => c[3]);
    expect(eventTypes).toContain(AgentEventType.INTELLIGENCE_TEAM_STARTED);
    expect(eventTypes).toContain(AgentEventType.INTELLIGENCE_TEAM_COMPLETED);
    expect(roleExec.run).toHaveBeenCalledTimes(4);
    expect(strategyEvidence.buildArchive).toHaveBeenCalledWith({
      ticker: 'AAPL',
    });
    expect(checkpoints.writeStrategyArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        stageKey: 'INTELLIGENCE',
        runId: 'r1',
        userId: 'u1',
        payload: expect.objectContaining({
          status: 'EVALUATED',
          ticker: 'AAPL',
        }),
      }),
    );
    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({
        stageKey: 'INTELLIGENCE',
        runId: 'r1',
        userId: 'u1',
        structuredOutput: expect.objectContaining({
          strategyArchivePayload: expect.objectContaining({
            status: 'EVALUATED',
            ticker: 'AAPL',
          }),
        }),
        humanReportMarkdown: expect.stringContaining('## Strategy Archive'),
      }),
    );
  });

  it('forwards userId to roleExecutor.run so tools can be built in scope', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const firstCall = roleExec.run.mock.calls[0]?.[0];
    expect(firstCall.userId).toBe('u1');
  });

  it('passes runId into context fabric assembly', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    expect(fabric.assemble).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', runId: 'r1', prompt: 'analyze AAPL' }),
    );
  });

  it('adds strategyArchivePayload to the committed team output', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const commitArg = checkpoints.commitStage.mock.calls[0]?.[0];
    expect(commitArg.structuredOutput.strategyArchivePayload).toMatchObject({
      status: 'EVALUATED',
      ticker: 'AAPL',
      summary: {
        warnings: ['no issues'],
      },
    });
  });

  it('writes the strategy archive before analyst failures can abort the stage', async () => {
    roleExec.run.mockRejectedValueOnce(new Error('role failed'));

    await expect(svc.execute({ runId: 'r1', userId: 'u1' })).rejects.toThrow('role failed');

    expect(strategyEvidence.buildArchive).toHaveBeenCalledWith({
      ticker: 'AAPL',
    });
    expect(checkpoints.writeStrategyArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        stageKey: 'INTELLIGENCE',
        runId: 'r1',
        userId: 'u1',
      }),
    );
    expect(checkpoints.commitStage).not.toHaveBeenCalled();
  });

  it('renders the strategy archive markdown section after the analyst reports', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const commitArg = checkpoints.commitStage.mock.calls[0]?.[0];
    expect(commitArg.humanReportMarkdown).toContain('## MARKET_ANALYST');
    expect(commitArg.humanReportMarkdown).toContain('## Strategy Archive');
    expect(commitArg.humanReportMarkdown.indexOf('## Strategy Archive')).toBeGreaterThan(
      commitArg.humanReportMarkdown.indexOf('## SENTIMENT_ANALYST'),
    );
    expect(commitArg.humanReportMarkdown).toContain('Status: EVALUATED');
    expect(commitArg.humanReportMarkdown).toContain('Selected template: none');
    expect(commitArg.humanReportMarkdown).toContain('Warnings:\n- no issues');
  });
});
