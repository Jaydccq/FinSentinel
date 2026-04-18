import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThesisTeamService } from '../teams/thesis-team.service';
import { AgentEventType } from '@finsentinel/shared';

function makeRoleOutput(roleKey: string, thesis: string) {
  return {
    roleKey,
    structured: {
      summary: 's',
      thesis,
      risks: [],
      openQuestions: [],
      citations: [],
      confidence: 0.75,
    },
    rawMarkdown: `${roleKey}-md`,
  };
}

describe('ThesisTeamService.execute', () => {
  let roleExec: { run: ReturnType<typeof vi.fn> };
  let runs: { getForUser: ReturnType<typeof vi.fn> };
  let checkpoints: {
    findByStage: ReturnType<typeof vi.fn>;
    commitStage: ReturnType<typeof vi.fn>;
  };
  let fabric: { assemble: ReturnType<typeof vi.fn>; toPromptReady: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: ThesisTeamService;
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
    roleExec = {
      run: vi.fn().mockImplementation(async ({ roleKey }) => {
        callOrder.push(roleKey);
        return makeRoleOutput(roleKey, `${roleKey}-thesis`);
      }),
    };
    runs = {
      getForUser: vi.fn().mockResolvedValue({
        id: 'r1',
        inputSnapshotJson: { prompt: 'analyze AAPL' },
      }),
    };
    checkpoints = {
      findByStage: vi.fn().mockResolvedValue({
        structuredOutputJson: {
          summary: 'intel',
          thesis: 'evidence gathered',
          risks: [],
          openQuestions: [],
          citations: [],
          confidence: 0.7,
        },
      }),
      commitStage: vi.fn().mockResolvedValue(undefined),
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
    svc = new ThesisTeamService(
      roleExec as never,
      runs as never,
      checkpoints as never,
      fabric as never,
      events as never,
    );
  });

  it('runs POSITIVE and NEGATIVE before THESIS_LEAD (barrier)', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const leadIdx = callOrder.indexOf('THESIS_LEAD');
    expect(leadIdx).toBeGreaterThan(callOrder.indexOf('POSITIVE_CASE'));
    expect(leadIdx).toBeGreaterThan(callOrder.indexOf('NEGATIVE_CASE'));
  });

  it('emits start/complete events for each role plus team-level events', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    const eventTypes = events.append.mock.calls.map((c) => c[3]);
    expect(eventTypes).toContain(AgentEventType.THESIS_TEAM_STARTED);
    expect(eventTypes).toContain(AgentEventType.POSITIVE_CASE_STARTED);
    expect(eventTypes).toContain(AgentEventType.NEGATIVE_CASE_STARTED);
    expect(eventTypes).toContain(AgentEventType.THESIS_LEAD_COMPLETED);
    expect(eventTypes).toContain(AgentEventType.THESIS_TEAM_COMPLETED);
  });

  it('commits THESIS checkpoint using the lead output', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    expect(checkpoints.commitStage).toHaveBeenCalledWith(
      expect.objectContaining({
        stageKey: 'THESIS',
        structuredOutput: expect.objectContaining({
          thesis: expect.stringContaining('THESIS_LEAD'),
        }),
      }),
    );
  });

  it('passes runId into context fabric assembly', async () => {
    await svc.execute({ runId: 'r1', userId: 'u1' });
    expect(fabric.assemble).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', runId: 'r1', prompt: 'analyze AAPL' }),
    );
  });
});
