import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

export const chatSessionMemories = pgTable('chat_session_memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  sessionId: uuid('session_id').notNull(),
  summaryText: text('summary_text').notNull().default(''),
  compactedMessageCount: integer('compacted_message_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uk_chat_session_memory_user_session').on(table.userId, table.sessionId),
  index('idx_chat_session_memories_user_session').on(table.userId, table.sessionId),
]);
