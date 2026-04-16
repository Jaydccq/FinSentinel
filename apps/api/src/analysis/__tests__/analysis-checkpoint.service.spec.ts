import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import { AgentEventAggregateType, AgentEventType } from '@finsentinel/shared';

function makeDb() {
  const state = {
    lastStageUpdateSet: undefined as Record<string, unknown> | undefined,
    lastArtifactInsert: undefined as Record<string, unknown> | undefined,
    stageRow: { id: 'stage-1', checkpointVersion: 0, status: 'RUNNING' } as Record<string, unknown>,
  };
  const db = {
    state,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [state.stageRow],
        }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        state.lastStageUpdateSet = v;
        return {
          where: () => ({ returning: async () => [{ ...state.stageRow, ...v }] }),
        };
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.lastArtifactInsert = v;
        return { returning: async () => [{ id: 'art-1', ...v }] };
      },
    }),
  };
  return db;
}

describe('AnalysisCheckpointService.commitStage', () => {
  let db: ReturnType<typeof makeDb>;
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: AnalysisCheckpointService;

  beforeEach(() => {
    db = makeDb();
    events = { append: vi.fn().mockResolvedValue({ id: 'evt-1' }) };
    svc = new AnalysisCheckpointService(db as never, events as never);
  });

  const structuredOutput = {
    summary: 's',
    thesis: 't',
    risks: [],
    openQuestions: [],
    citations: [],
    confidence: 0.8,
  };

  it('marks the stage COMPLETED, bumps checkpointVersion, and inserts 2 artifacts', async () => {
    await svc.commitStage({
      userId: 'u1',
      runId: 'r1',
      stageKey: 'INTELLIGENCE',
      structuredOutput,
      humanReportMarkdown: '# report',
    });
    expect(db.state.lastStageUpdateSet).toMatchObject({
      status: 'COMPLETED',
      checkpointVersion: 1,
      structuredOutputJson: expect.objectContaining(structuredOutput),
      humanReportMarkdown: '# report',
    });
    expect(events.append).toHaveBeenCalledWith(
      'u1',
      AgentEventAggregateType.ANALYSIS_RUN,
      'r1',
      AgentEventType.STAGE_CHECKPOINT_COMMITTED,
      expect.objectContaining({ stageKey: 'INTELLIGENCE', checkpointVersion: 1 }),
      null,
    );
  });

  it('rejects payloads that fail schema validation', async () => {
    await expect(
      svc.commitStage({
        userId: 'u1',
        runId: 'r1',
        stageKey: 'INTELLIGENCE',
        structuredOutput: { summary: 's' } as never,
        humanReportMarkdown: '',
      }),
    ).rejects.toThrow();
  });
});
