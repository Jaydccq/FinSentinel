import { index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { analysisRuns } from './analysis-runs';
import { users } from './users';

export const contextJournalEntries = pgTable(
  'context_journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sessionId: uuid('session_id'),
    runId: uuid('run_id').references(() => analysisRuns.id, { onDelete: 'cascade' }),
    stageKey: varchar('stage_key', { length: 32 }),
    roleKey: varchar('role_key', { length: 64 }),
    entryType: varchar('entry_type', { length: 40 }).notNull(),
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    sourceRef: varchar('source_ref', { length: 255 }),
    payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_context_journal_run_created').on(table.runId, table.createdAt.desc()),
    index('idx_context_journal_session_created').on(table.sessionId, table.createdAt.desc()),
    index('idx_context_journal_stage_created').on(table.runId, table.stageKey, table.createdAt.desc()),
  ],
);
