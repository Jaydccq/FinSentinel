import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  role: varchar('role', { length: 20 }).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_chat_messages_user_id').on(table.userId),
  index('idx_chat_messages_session_id').on(table.sessionId),
]);
