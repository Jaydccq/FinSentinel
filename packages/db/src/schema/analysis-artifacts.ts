import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { analysisRuns } from './analysis-runs';
import { analysisStages } from './analysis-stages';
import type { ArtifactKind } from '@finsentinel/shared';

export const analysisArtifacts = pgTable(
  'analysis_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id').references(() => analysisStages.id, {
      onDelete: 'set null',
    }),
    artifactKind: varchar('artifact_kind', { length: 32 }).$type<ArtifactKind>().notNull(),
    artifactName: varchar('artifact_name', { length: 120 }).notNull(),
    mimeType: varchar('mime_type', { length: 80 }).notNull().default('application/json'),
    payloadJson: jsonb('payload_json').$type<Record<string, unknown> | null>(),
    storageUri: varchar('storage_uri', { length: 512 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_analysis_artifacts_run_kind').on(table.runId, table.artifactKind),
    index('idx_analysis_artifacts_stage').on(table.stageId),
  ],
);
