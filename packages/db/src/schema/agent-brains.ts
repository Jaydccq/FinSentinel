import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const agentBrains = pgTable('agent_brains', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  frontalLobe: text('frontal_lobe').notNull().default(''),
  emotion: varchar('emotion', { length: 20 }).notNull().default('neutral'),
  commitHistory: jsonb('commit_history').$type<unknown[]>().notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('idx_agent_brains_user_id').on(table.userId),
]);
