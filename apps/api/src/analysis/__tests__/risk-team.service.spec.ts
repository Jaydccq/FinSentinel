import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RiskTeamService } from '../teams/risk-team.service';
import { AgentEventType, strategyArchivePayloadSchema } from '@finsentinel/shared';

const intelligenceArchive = strategyArchivePayloadSchema.parse({
  status: 'EVALUATED',
  generatedAt: '2026-04-18T00:00:00.000Z',
  ticker: 'AAPL',
  bars: {
    requestedDays: 260,
    receivedBars: 260,
    source: 'market-data',
  },
  evaluations: [],
  selectedTemplateKey: null,
  summary: {
    enterLongCount: 1,
    blockedCount: 0,
    warnings: [],
    recommendedNextStep: 'PAPER_ONLY',
  },
});

const pmArchive = strategyArchivePayloadSchema.parse({
  status: 'DEGRADED',
  generatedAt: '2026-04-18T01:00:00.000Z',
  ticker: 'AAPL',
  bars: {
    requestedDays: 260,
    receivedBars: 200,
    source: 'market-data',
  },
  evaluations: [],
  selectedTemplateKey: null,
  summary: {
    enterLongCount: 0,
    blockedCount: 1,
    warnings: ['insufficient bars'],
    recommendedNextStep: 'REVIEW_FOR_BACKTEST',
  },
});

describe('RiskTeamService.execute', () => {
  let roleExec: { run: ReturnType<typeof vi.fn> };
  let runs: { getForUser: ReturnType<typeof vi.fn> };
  let checkpoints: {
    findByStage: ReturnType<typeof vi.fn>;
    commitStage: ReturnType<typeof vi.fn>;
  };
  let fabric: { assemble: ReturnType<typeof vi.fn>; toPromptReady: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: RiskTeamService;

  beforeEach(() => {
    roleExec = {
      run: vi.fn().mockImplementation(async ({ roleKey }) => ({
        roleKey,
        structured: {
          summary: 's',
          thesis: 't',
          risks: [],
          openQuestions: [],
          citations: [],
          confidence: 0.8,
          portfolioDecision: 'HOLD',
          allocationGuidance: { notes: '', targets: [] },
          riskLimits: { maxDrawdownPct: 10, stopLossTriggers: [] },
          alertTriggers: [],
          strategyArchivePayload: roleKey === 'PORTFOLIO_MANAGER' ? pmArchive : undefined,
        },
        rawMarkdown: `${roleKey}-md`,
        durationMs: 75,
        toolCallCount: 3,
      })),
    };
    runs = {
      getForUser: vi.fn().mockResolvedValue({
        id: 'r1',
        inputSnapshotJson: { prompt: 'x' },
      }),
    };
    checkpoints = {
      findByStage: vi.fn().mockImplementation(async (_runId, stageKey) => {
        if (stageKey === 'INTELLIGENCE') {
          return {
            structuredOutputJson: {
              summary: 'prior',
              strategyArchivePayload: intelligenceArchive,
            },
          };
        }
        return { structuredOutputJson: { summary: 'prior' } };
      }),
      commitStage: vi.fn().mockResolvedValue(undefined),
    };
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
    svc = new RiskTeamService(
      roleExec as never,
      runs as never,
      checkpoints as never,
      fabric as never,
      events as never,
    );
  });

  it('passes the intelligence archive into risk roles and prefers a valid PM archive', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const ran = roleExec.run.mock.calls.map((c) => c[0].roleKey);
    expect(ran).toEqual(['RISK_REVIEWER', 'PORTFOLIO_MANAGER']);
    expect(roleExec.run.mock.calls[0][0].userInput.extra.strategyArchivePayload).toEqual(
      intelligenceArchive,
    );
    expect(roleExec.run.mock.calls[1][0].userInput.extra.strategyArchivePayload).toEqual(
      intelligenceArchive,
    );
    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({
        stageKey: 'RISK',
        structuredOutput: expect.objectContaining({
          strategyArchivePayload: pmArchive,
        }),
      }),
    );
    expect(roleExec.run.mock.calls[0][0].systemPrompt).toContain('advisory evidence only');
    const eventTypes = events.append.mock.calls.map((c) => c[3]);
    expect(eventTypes).toContain(AgentEventType.RISK_TEAM_STARTED);
    expect(eventTypes).toContain(AgentEventType.RISK_TEAM_COMPLETED);
  });

  it('passes runId into context fabric assembly', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    expect(fabric.assemble).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', runId: 'r1', prompt: 'x' }),
    );
  });

  it('writes roleSummaries for RISK_REVIEWER and PORTFOLIO_MANAGER into structuredOutput', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const commitArg = checkpoints.commitStage.mock.calls[0]?.[0];
    const summaries = commitArg?.structuredOutput?.roleSummaries;
    expect(summaries?.map((s: { roleKey: string }) => s.roleKey)).toEqual([
      'RISK_REVIEWER',
      'PORTFOLIO_MANAGER',
    ]);
  });

  it('falls back to the intelligence archive when the PM archive is invalid', async () => {
    roleExec.run = vi.fn().mockImplementation(async ({ roleKey }) => ({
      roleKey,
      structured: {
        summary: 's',
        thesis: 't',
        risks: [],
        openQuestions: [],
        citations: [],
        confidence: 0.8,
        portfolioDecision: 'HOLD',
        allocationGuidance: { notes: '', targets: [] },
        riskLimits: { maxDrawdownPct: 10, stopLossTriggers: [] },
        alertTriggers: [],
        strategyArchivePayload:
          roleKey === 'PORTFOLIO_MANAGER' ? { snapshot: { legacy: true } } : undefined,
      },
      rawMarkdown: `${roleKey}-md`,
    }));

    await svc.execute({ runId: 'r1', userId: 'u1' });

    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({
        structuredOutput: expect.objectContaining({
          strategyArchivePayload: intelligenceArchive,
        }),
      }),
    );
  });

  it('falls back to the compatibility snapshot when neither role has an archive', async () => {
    roleExec.run = vi.fn().mockImplementation(async ({ roleKey }) => ({
      roleKey,
      structured: {
        summary: 's',
        thesis: 't',
        risks: [],
        openQuestions: [],
        citations: [],
        confidence: 0.8,
        portfolioDecision: 'HOLD',
        allocationGuidance: { notes: '', targets: [] },
        riskLimits: { maxDrawdownPct: 10, stopLossTriggers: [] },
        alertTriggers: [],
      },
      rawMarkdown: `${roleKey}-md`,
    }));
    checkpoints.findByStage = vi
      .fn()
      .mockResolvedValue({ structuredOutputJson: { summary: 'prior' } });

    await svc.execute({ runId: 'r1', userId: 'u1' });

    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({
        structuredOutput: expect.objectContaining({
          strategyArchivePayload: { snapshot: {} },
        }),
      }),
    );
  });
});
