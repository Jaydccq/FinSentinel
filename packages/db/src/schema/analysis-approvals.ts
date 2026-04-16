import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { analysisRuns } from './analysis-runs';
import { users } from './users';
import type { ApprovalStatus } from '@finsentinel/shared';

export const analysisApprovals = pgTable(
  'analysis_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'cascade' }),
    approvalType: varchar('approval_type', { length: 40 })
      .notNull()
      .default('EXECUTION_APPROVAL'),
    status: varchar('status', { length: 16 })
      .$type<ApprovalStatus>()
      .notNull()
      .default('PENDING'),
    requestedPayloadJson: jsonb('requested_payload_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    approvedPayloadJson: jsonb('approved_payload_json')
      .$type<Record<string, unknown> | null>(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
  },
  (table) => [
    index('idx_analysis_approvals_run_status').on(table.runId, table.status),
  ],
);
