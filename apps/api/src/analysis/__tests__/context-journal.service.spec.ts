import { describe, expect, it, vi } from 'vitest';

import { ContextJournalService } from '../context-journal.service';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const RUN_ID = '22222222-2222-2222-2222-222222222222';

describe('ContextJournalService', () => {
  it('writes stage input snapshots and builds lineage-aware shared context', async () => {
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'journal-1' }]),
    };
    const rows = [
      {
        id: 'ctx-1',
        entryType: 'COMPACTION_SUMMARY',
        payloadJson: { summaryText: 'prior chat summary' },
        sourceRef: 'chat_session_memories/session-1',
        createdAt: new Date('2026-04-18T12:00:00.000Z'),
      },
      {
        id: 'rag-1',
        entryType: 'RAG_EVIDENCE',
        payloadJson: { summary: 'retrieved document summary' },
        sourceRef: 'documents/doc-1',
        createdAt: new Date('2026-04-18T12:01:00.000Z'),
      },
      {
        id: 'stage-1',
        entryType: 'STAGE_INPUT',
        payloadJson: {
          contextEntryIds: ['ctx-1'],
          priorStageKeys: ['INTELLIGENCE'],
          evidenceEntryIds: ['rag-1'],
          promptHash: 'hash-1',
          tokenBudget: 12000,
          truncationApplied: false,
        },
        sourceRef: 'analysis_runs/22222222-2222-2222-2222-222222222222',
        createdAt: new Date('2026-04-18T12:02:00.000Z'),
      },
    ];
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    };
    const db = {
      insert: vi.fn().mockReturnValue(insertChain),
      select: vi.fn().mockReturnValue(selectChain),
    } as never;
    const service = new ContextJournalService(db);

    await service.appendStageInput({
      userId: USER_ID,
      runId: RUN_ID,
      stageKey: 'THESIS',
      roleKey: 'THESIS_LEAD',
      payload: {
        contextEntryIds: ['ctx-1'],
        priorStageKeys: ['INTELLIGENCE'],
        evidenceEntryIds: ['rag-1'],
        promptHash: 'hash-1',
        tokenBudget: 12000,
        truncationApplied: false,
      },
    });
    const context = await service.getRunContext(USER_ID, RUN_ID);
    const insertValues = insertChain.values.mock.calls[0]![0] as Record<string, unknown>;

    expect(db.insert).toHaveBeenCalled();
    expect(insertValues.id).toEqual(expect.any(String));
    expect(insertValues.sessionId).toBeNull();
    expect(insertValues.runId).toBe(RUN_ID);
    expect(context.shortTermSessionContext.summary).toContain('prior chat summary');
    expect(context.shortTermSessionContext.sourceIds).toContain('ctx-1');
    expect(context.retrievalContext.summary).toContain('retrieved document summary');
    expect(context.retrievalContext.sourceIds).toContain('rag-1');
  });

  it('keeps stage-input lineage authoritative when referenced ids are empty', async () => {
    const rows = [
      {
        id: 'ctx-1',
        entryType: 'COMPACTION_SUMMARY',
        payloadJson: { summaryText: 'prior chat summary' },
        sourceRef: 'chat_session_memories/session-1',
        createdAt: new Date('2026-04-18T12:00:00.000Z'),
      },
      {
        id: 'rag-1',
        entryType: 'RAG_EVIDENCE',
        payloadJson: { summary: 'retrieved document summary' },
        sourceRef: 'documents/doc-1',
        createdAt: new Date('2026-04-18T12:01:00.000Z'),
      },
      {
        id: 'stage-empty',
        entryType: 'STAGE_INPUT',
        payloadJson: {
          contextEntryIds: [],
          priorStageKeys: ['INTELLIGENCE'],
          evidenceEntryIds: [],
          promptHash: 'hash-empty',
          tokenBudget: 12000,
          truncationApplied: false,
        },
        sourceRef: 'analysis_runs/22222222-2222-2222-2222-222222222222',
        createdAt: new Date('2026-04-18T12:02:00.000Z'),
      },
    ];
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    };
    const db = {
      insert: vi.fn(),
      select: vi.fn().mockReturnValue(selectChain),
    } as never;
    const service = new ContextJournalService(db);

    const context = await service.getRunContext(USER_ID, RUN_ID);

    expect(context.shortTermSessionContext.summary).toBe('');
    expect(context.shortTermSessionContext.sourceIds).toEqual([]);
    expect(context.retrievalContext.summary).toBe('');
    expect(context.retrievalContext.sourceIds).toEqual([]);
  });

  it('only includes source ids and updatedAt for rows that contribute summary text', async () => {
    const rows = [
      {
        id: 'ctx-empty',
        entryType: 'COMPACTION_SUMMARY',
        payloadJson: { summaryText: '' },
        sourceRef: 'chat_session_memories/session-1',
        createdAt: new Date('2026-04-18T12:00:00.000Z'),
      },
      {
        id: 'ctx-text',
        entryType: 'COMPACTION_SUMMARY',
        payloadJson: { summaryText: 'prior chat summary' },
        sourceRef: 'chat_session_memories/session-1',
        createdAt: new Date('2026-04-18T12:01:00.000Z'),
      },
      {
        id: 'ctx-empty-late',
        entryType: 'COMPACTION_SUMMARY',
        payloadJson: { summaryText: '' },
        sourceRef: 'chat_session_memories/session-1',
        createdAt: new Date('2026-04-18T12:02:00.000Z'),
      },
      {
        id: 'stage-1',
        entryType: 'STAGE_INPUT',
        payloadJson: {
          contextEntryIds: ['ctx-empty', 'ctx-text'],
          priorStageKeys: ['INTELLIGENCE'],
          evidenceEntryIds: [],
          promptHash: 'hash-1',
          tokenBudget: 12000,
          truncationApplied: false,
        },
        sourceRef: 'analysis_runs/22222222-2222-2222-2222-222222222222',
        createdAt: new Date('2026-04-18T12:02:00.000Z'),
      },
    ];
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    };
    const db = {
      insert: vi.fn(),
      select: vi.fn().mockReturnValue(selectChain),
    } as never;
    const service = new ContextJournalService(db);

    const context = await service.getRunContext(USER_ID, RUN_ID);

    expect(context.shortTermSessionContext.summary).toBe('prior chat summary');
    expect(context.shortTermSessionContext.sourceIds).toEqual(['ctx-text']);
    expect(context.shortTermSessionContext.updatedAt).toBe('2026-04-18T12:01:00.000Z');
  });

  it('ignores whitespace-only summary text when building journal layers', async () => {
    const rows = [
      {
        id: 'ctx-whitespace',
        entryType: 'COMPACTION_SUMMARY',
        payloadJson: { summaryText: '   ' },
        sourceRef: 'chat_session_memories/session-1',
        createdAt: new Date('2026-04-18T12:01:30.000Z'),
      },
      {
        id: 'ctx-text',
        entryType: 'COMPACTION_SUMMARY',
        payloadJson: { summaryText: 'prior chat summary' },
        sourceRef: 'chat_session_memories/session-1',
        createdAt: new Date('2026-04-18T12:01:00.000Z'),
      },
      {
        id: 'stage-1',
        entryType: 'STAGE_INPUT',
        payloadJson: {
          contextEntryIds: ['ctx-whitespace', 'ctx-text'],
          priorStageKeys: ['INTELLIGENCE'],
          evidenceEntryIds: [],
          promptHash: 'hash-1',
          tokenBudget: 12000,
          truncationApplied: false,
        },
        sourceRef: 'analysis_runs/22222222-2222-2222-2222-222222222222',
        createdAt: new Date('2026-04-18T12:02:00.000Z'),
      },
    ];
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    };
    const db = {
      insert: vi.fn(),
      select: vi.fn().mockReturnValue(selectChain),
    } as never;
    const service = new ContextJournalService(db);

    const context = await service.getRunContext(USER_ID, RUN_ID);

    expect(context.shortTermSessionContext.summary).toBe('prior chat summary');
    expect(context.shortTermSessionContext.sourceIds).toEqual(['ctx-text']);
    expect(context.shortTermSessionContext.updatedAt).toBe('2026-04-18T12:01:00.000Z');
  });

  it('does not fall back to unrelated rows when referenced rows are missing', async () => {
    const rows = [
      {
        id: 'ctx-1',
        entryType: 'COMPACTION_SUMMARY',
        payloadJson: { summaryText: 'unrelated chat summary' },
        sourceRef: 'chat_session_memories/session-1',
        createdAt: new Date('2026-04-18T12:00:00.000Z'),
      },
      {
        id: 'rag-1',
        entryType: 'RAG_EVIDENCE',
        payloadJson: { summary: 'unrelated retrieval summary' },
        sourceRef: 'documents/doc-1',
        createdAt: new Date('2026-04-18T12:01:00.000Z'),
      },
      {
        id: 'stage-missing',
        entryType: 'STAGE_INPUT',
        payloadJson: {
          contextEntryIds: ['ctx-missing'],
          priorStageKeys: ['INTELLIGENCE'],
          evidenceEntryIds: ['rag-missing'],
          promptHash: 'hash-missing',
          tokenBudget: 12000,
          truncationApplied: false,
        },
        sourceRef: 'analysis_runs/22222222-2222-2222-2222-222222222222',
        createdAt: new Date('2026-04-18T12:02:00.000Z'),
      },
    ];
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(rows),
    };
    const db = {
      insert: vi.fn(),
      select: vi.fn().mockReturnValue(selectChain),
    } as never;
    const service = new ContextJournalService(db);

    const context = await service.getRunContext(USER_ID, RUN_ID);

    expect(context.shortTermSessionContext.summary).toBe('');
    expect(context.shortTermSessionContext.sourceIds).toEqual([]);
    expect(context.retrievalContext.summary).toBe('');
    expect(context.retrievalContext.sourceIds).toEqual([]);
  });

  it('returns the latest stage input payload for a run stage', async () => {
    const payload = {
      contextEntryIds: ['ctx-latest'],
      priorStageKeys: ['INTELLIGENCE'],
      evidenceEntryIds: ['rag-latest'],
      promptHash: 'hash-latest',
      tokenBudget: 9000,
      truncationApplied: true,
    };
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ payloadJson: payload }]),
    };
    const db = {
      insert: vi.fn(),
      select: vi.fn().mockReturnValue(selectChain),
    } as never;
    const service = new ContextJournalService(db);

    await expect(service.getStageInput(USER_ID, RUN_ID, 'THESIS')).resolves.toEqual(payload);
  });
});
