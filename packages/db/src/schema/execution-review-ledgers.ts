import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { analysisRuns } from './analysis-runs';
import { analysisApprovals } from './analysis-approvals';

export const executionReviewLedgers = pgTable('execution_review_ledgers', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => analysisRuns.id, { onDelete: 'cascade' }),
  approvalId: uuid('approval_id').notNull().references(() => analysisApprovals.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 16 }).notNull(),
  orderDraftRefs: jsonb('order_draft_refs_json').$type<string[]>().notNull().default([]),
  stagedOperationRefs: jsonb('staged_operation_refs_json').$type<string[]>().notNull().default([]),
  commitHash: varchar('commit_hash', { length: 128 }),
  executionResultRef: varchar('execution_result_ref', { length: 255 }),
  rejectionNote: varchar('rejection_note', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_execution_review_ledgers_run').on(table.runId, table.updatedAt.desc()),
  index('idx_execution_review_ledgers_approval').on(table.approvalId),
]);
