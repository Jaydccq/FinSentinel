import {
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { analysisRuns } from './analysis-runs';
import type {
  AnalysisStageKey,
  StageStatus,
} from '@finsentinel/shared';

export const analysisStages = pgTable(
  'analysis_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'cascade' }),
    stageKey: varchar('stage_key', { length: 32 })
      .$type<AnalysisStageKey>()
      .notNull(),
    status: varchar('status', { length: 16 })
      .$type<StageStatus>()
      .notNull()
      .default('PENDING'),
    checkpointVersion: integer('checkpoint_version').notNull().default(0),
    parallelGroupKey: varchar('parallel_group_key', { length: 40 }),
    structuredOutputJson: jsonb('structured_output_json')
      .$type<Record<string, unknown> | null>(),
    humanReportMarkdown: text('human_report_markdown'),
    errorJson: jsonb('error_json').$type<Record<string, unknown> | null>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uk_analysis_stages_run_stage_key').on(table.runId, table.stageKey),
    index('idx_analysis_stages_run_status').on(table.runId, table.status),
  ],
);
