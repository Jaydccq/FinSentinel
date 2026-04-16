import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntelligenceTeamService } from '../teams/intelligence-team.service';
import { AgentEventType } from '@finsentinel/shared';

describe('IntelligenceTeamService.execute', () => {
  let roleExec: { run: ReturnType<typeof vi.fn> };
  let runs: { getForUser: ReturnType<typeof vi.fn> };
  let checkpoints: { commitStage: ReturnType<typeof vi.fn> };
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
    checkpoints = { commitStage: vi.fn().mockResolvedValue(undefined) };
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
    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({ stageKey: 'INTELLIGENCE', runId: 'r1', userId: 'u1' }),
    );
  });

  it('forwards userId to roleExecutor.run so tools can be built in scope', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const firstCall = roleExec.run.mock.calls[0]?.[0];
    expect(firstCall.userId).toBe('u1');
  });
});
