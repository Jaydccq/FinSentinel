import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RiskTeamService } from '../teams/risk-team.service';
import { AgentEventType } from '@finsentinel/shared';

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
        },
        rawMarkdown: `${roleKey}-md`,
      })),
    };
    runs = {
      getForUser: vi.fn().mockResolvedValue({
        id: 'r1',
        inputSnapshotJson: { prompt: 'x' },
      }),
    };
    checkpoints = {
      findByStage: vi.fn().mockResolvedValue({ structuredOutputJson: { summary: 'prior' } }),
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

  it('runs reviewer then portfolio manager and commits RISK stage', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const ran = roleExec.run.mock.calls.map((c) => c[0].roleKey);
    expect(ran).toEqual(['RISK_REVIEWER', 'PORTFOLIO_MANAGER']);
    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({ stageKey: 'RISK' }),
    );
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
});
