import { z } from 'zod';

import { analysisStageKeySchema } from './analysis';

export const contextJournalEntryTypeSchema = z.enum([
  'USER_MESSAGE',
  'ASSISTANT_MESSAGE',
  'COMPACTION_BOUNDARY',
  'COMPACTION_SUMMARY',
  'RAG_EVIDENCE',
  'TOOL_CALL',
  'TOOL_RESULT',
  'STAGE_INPUT',
  'STAGE_OUTPUT',
  'RUN_UPGRADE_LINK',
  'NOTIFICATION',
]);
export type ContextJournalEntryType = z.infer<typeof contextJournalEntryTypeSchema>;

export const stageInputSnapshotSchema = z.object({
  contextEntryIds: z.array(z.string()),
  priorStageKeys: z.array(analysisStageKeySchema),
  evidenceEntryIds: z.array(z.string()),
  promptHash: z.string(),
  tokenBudget: z.number().int().nonnegative(),
  truncationApplied: z.boolean(),
});
export type StageInputSnapshot = z.infer<typeof stageInputSnapshotSchema>;

export const contextJournalEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  runId: z.string().uuid().nullable(),
  stageKey: analysisStageKeySchema.nullable(),
  roleKey: z.string().nullable(),
  entryType: contextJournalEntryTypeSchema,
  sourceType: z.string(),
  sourceRef: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type ContextJournalEntry = z.infer<typeof contextJournalEntrySchema>;

export const runtimeTimelineEventSchema = z.object({
  id: z.string().uuid(),
  seqNo: z.number().int(),
  aggregateId: z.string().uuid(),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type RuntimeTimelineEvent = z.infer<typeof runtimeTimelineEventSchema>;
