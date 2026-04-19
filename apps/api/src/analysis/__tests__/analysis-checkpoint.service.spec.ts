import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisCheckpointService } from '../analysis-checkpoint.service';
import {
  AgentEventAggregateType,
  AgentEventType,
  strategyArchivePayloadSchema,
} from '@finsentinel/shared';

function makeDb(stageRow: Record<string, unknown> | null = {
  id: 'stage-1',
  checkpointVersion: 0,
  status: 'RUNNING',
}) {
  const state = {
    lastStageUpdateSet: undefined as Record<string, unknown> | undefined,
    lastArtifactInsert: undefined as Record<string, unknown> | undefined,
    stageRow,
  };
  const db = {
    state,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.stageRow ? [state.stageRow] : []),
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

describe('AnalysisCheckpointService.writeStrategyArchive', () => {
  let db: ReturnType<typeof makeDb>;
  let events: { append: ReturnType<typeof vi.fn> };
  let svc: AnalysisCheckpointService;

  beforeEach(() => {
    db = makeDb();
    events = { append: vi.fn().mockResolvedValue({ id: 'evt-1' }) };
    svc = new AnalysisCheckpointService(db as never, events as never);
  });

  const payload = strategyArchivePayloadSchema.parse({
    status: 'EVALUATED',
    ticker: 'AAPL',
    generatedAt: '2026-04-18T12:00:00.000Z',
    bars: {
      requestedDays: 260,
      receivedBars: 260,
      source: 'polygon',
    },
    evaluations: [],
    selectedTemplateKey: null,
    summary: {
      enterLongCount: 0,
      blockedCount: 0,
      warnings: [],
      recommendedNextStep: null,
    },
  });

  it('inserts a STRATEGY_ARCHIVE artifact for the matched stage', async () => {
    await svc.writeStrategyArchive({
      userId: 'u1',
      runId: 'r1',
      stageKey: 'INTELLIGENCE',
      payload,
    });

    expect(db.state.lastArtifactInsert).toMatchObject({
      runId: 'r1',
      stageId: 'stage-1',
      artifactKind: 'STRATEGY_ARCHIVE',
      artifactName: 'strategy-archive.json',
      mimeType: 'application/json',
      payloadJson: payload,
    });
    expect(db.state.lastStageUpdateSet).toBeUndefined();
    expect(events.append).not.toHaveBeenCalled();
  });

  it('rejects payloads that fail schema validation before insert', async () => {
    await expect(
      svc.writeStrategyArchive({
        userId: 'u1',
        runId: 'r1',
        stageKey: 'INTELLIGENCE',
        payload: {
          status: 'EVALUATED',
          ticker: 'AAPL',
        } as never,
      }),
    ).rejects.toThrow();

    expect(db.state.lastArtifactInsert).toBeUndefined();
  });

  it('throws NotFoundException when the stage does not exist', async () => {
    db = makeDb(null);
    svc = new AnalysisCheckpointService(db as never, events as never);

    await expect(
      svc.writeStrategyArchive({
        userId: 'u1',
        runId: 'r1',
        stageKey: 'INTELLIGENCE',
        payload,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(db.state.lastArtifactInsert).toBeUndefined();
  });
});
