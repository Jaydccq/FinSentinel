import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  numeric,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import type {
  AnalysisRunSourceMode,
  AnalysisRunStatus,
  AnalysisStageKey,
  SharedContext,
  DecisionObject,
} from '@finsentinel/shared';

export const analysisRuns = pgTable(
  'analysis_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sourceMode: varchar('source_mode', { length: 20 }).$type<AnalysisRunSourceMode>().notNull(),
    status: varchar('status', { length: 24 })
      .$type<AnalysisRunStatus>()
      .notNull()
      .default('QUEUED'),
    currentStageKey: varchar('current_stage_key', { length: 32 }).$type<AnalysisStageKey>(),
    complexityScore: numeric('complexity_score', { precision: 8, scale: 2 }),
    upgradeReason: varchar('upgrade_reason', { length: 255 }),
    parentChatSessionId: uuid('parent_chat_session_id'),
    inputSnapshotJson: jsonb('input_snapshot_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sharedContextJson: jsonb('shared_context_json').$type<SharedContext | null>(),
    decisionObjectJson: jsonb('decision_object_json').$type<DecisionObject | null>(),
    finalReportMarkdown: text('final_report_markdown'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_analysis_runs_user_created').on(table.userId, table.createdAt.desc()),
    index('idx_analysis_runs_user_status').on(table.userId, table.status),
    index('idx_analysis_runs_parent_chat_session').on(table.parentChatSessionId),
  ],
);
