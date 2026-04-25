import { pgTable, uuid, varchar, jsonb, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const agentSchedules = pgTable(
  'agent_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 120 }).notNull(),
    cronExpression: varchar('cron_expression', { length: 120 }).notNull(),
    taskType: varchar('task_type', { length: 50 }).notNull(),
    taskPayload: jsonb('task_payload').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_agent_schedules_user_created').on(table.userId, table.createdAt.desc()),
    index('idx_agent_schedules_enabled_next_run').on(table.enabled, table.nextRunAt),
  ],
);
