import { describe, expect, it } from 'vitest';

import {
  contextJournalEntrySchema,
  runtimeTimelineEventSchema,
  stageInputSnapshotSchema,
} from '../schemas/context-journal';

describe('context journal contracts', () => {
  it('parses a lineage-aware stage input entry', () => {
    const parsed = contextJournalEntrySchema.parse({
      id: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      sessionId: '33333333-3333-3333-3333-333333333333',
      runId: '44444444-4444-4444-4444-444444444444',
      stageKey: 'THESIS',
      roleKey: 'THESIS_LEAD',
      entryType: 'STAGE_INPUT',
      sourceType: 'RUN',
      sourceRef: 'analysis_runs/44444444-4444-4444-4444-444444444444',
      payload: stageInputSnapshotSchema.parse({
        contextEntryIds: ['ctx-1', 'ctx-2'],
        priorStageKeys: ['INTELLIGENCE'],
        evidenceEntryIds: ['rag-1'],
        promptHash: 'abc123',
        tokenBudget: 12000,
        truncationApplied: false,
      }),
      createdAt: new Date().toISOString(),
    });

    expect(parsed.entryType).toBe('STAGE_INPUT');
  });

  it('parses a runtime timeline event', () => {
    const event = runtimeTimelineEventSchema.parse({
      id: '55555555-5555-5555-5555-555555555555',
      seqNo: 101,
      aggregateId: '44444444-4444-4444-4444-444444444444',
      eventType: 'ROLE_COMPLETED',
      payload: { stageKey: 'THESIS', roleKey: 'THESIS_LEAD', durationMs: 8100 },
      createdAt: new Date().toISOString(),
    });

    expect(event.eventType).toBe('ROLE_COMPLETED');
  });

  it('rejects invalid UUIDs', () => {
    expect(
      contextJournalEntrySchema.safeParse({
        id: 'not-a-uuid',
        userId: '22222222-2222-2222-2222-222222222222',
        sessionId: null,
        runId: null,
        stageKey: null,
        roleKey: null,
        entryType: 'USER_MESSAGE',
        sourceType: 'CHAT',
        sourceRef: null,
        payload: {},
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });

  it('rejects invalid entryType values', () => {
    expect(
      contextJournalEntrySchema.safeParse({
        id: '11111111-1111-1111-1111-111111111111',
        userId: '22222222-2222-2222-2222-222222222222',
        sessionId: null,
        runId: null,
        stageKey: 'THESIS',
        roleKey: null,
        entryType: 'BAD_TYPE',
        sourceType: 'CHAT',
        sourceRef: null,
        payload: {},
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });

  it('rejects invalid stageKey values', () => {
    expect(
      contextJournalEntrySchema.safeParse({
        id: '11111111-1111-1111-1111-111111111111',
        userId: '22222222-2222-2222-2222-222222222222',
        sessionId: null,
        runId: null,
        stageKey: 'BAD_STAGE',
        roleKey: null,
        entryType: 'USER_MESSAGE',
        sourceType: 'CHAT',
        sourceRef: null,
        payload: {},
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });

  it('rejects negative token budgets', () => {
    expect(
      stageInputSnapshotSchema.safeParse({
        contextEntryIds: [],
        priorStageKeys: ['INTELLIGENCE'],
        evidenceEntryIds: [],
        promptHash: 'abc123',
        tokenBudget: -1,
        truncationApplied: false,
      }).success,
    ).toBe(false);
  });

  it('rejects overlong roleKey values', () => {
    expect(
      contextJournalEntrySchema.safeParse({
        id: '11111111-1111-1111-1111-111111111111',
        userId: '22222222-2222-2222-2222-222222222222',
        sessionId: null,
        runId: null,
        stageKey: null,
        roleKey: 'y'.repeat(65),
        entryType: 'ASSISTANT_MESSAGE',
        sourceType: 'CHAT',
        sourceRef: null,
        payload: {},
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });

  it('rejects overlong sourceType values', () => {
    expect(
      contextJournalEntrySchema.safeParse({
        id: '11111111-1111-1111-1111-111111111111',
        userId: '22222222-2222-2222-2222-222222222222',
        sessionId: null,
        runId: null,
        stageKey: null,
        roleKey: null,
        entryType: 'ASSISTANT_MESSAGE',
        sourceType: 'z'.repeat(33),
        sourceRef: null,
        payload: {},
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });

  it('rejects overlong sourceRef values', () => {
    expect(
      contextJournalEntrySchema.safeParse({
        id: '11111111-1111-1111-1111-111111111111',
        userId: '22222222-2222-2222-2222-222222222222',
        sessionId: null,
        runId: null,
        stageKey: null,
        roleKey: null,
        entryType: 'ASSISTANT_MESSAGE',
        sourceType: 'CHAT',
        sourceRef: 'x'.repeat(256),
        payload: {},
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });
});
