import { pgTable, uuid, bigint, varchar, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const agentEvents = pgTable('agent_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  seqNo: bigint('seq_no', { mode: 'number' }).generatedAlwaysAsIdentity().unique(),
  userId: uuid('user_id').notNull().references(() => users.id),
  aggregateType: varchar('aggregate_type', { length: 50 }).notNull(),
  aggregateId: uuid('aggregate_id'),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: varchar('idempotency_key', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_agent_events_user_seq').on(table.userId, table.seqNo.desc()),
  index('idx_agent_events_user_created').on(table.userId, table.createdAt.desc()),
  index('idx_agent_events_aggregate').on(table.aggregateType, table.aggregateId, table.createdAt.desc()),
  uniqueIndex('idx_agent_events_user_idempotency_key')
    .on(table.userId, table.idempotencyKey)
    .where(sql`idempotency_key IS NOT NULL`),
]);
