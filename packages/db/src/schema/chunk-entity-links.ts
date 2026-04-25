import { pgTable, uuid, varchar, real, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const chunkEntityLinks = pgTable(
  'chunk_entity_links',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id').notNull(),
    chunkId: uuid('chunk_id').notNull(),
    mentionText: varchar('mention_text', { length: 500 }).notNull(),
    confidence: real('confidence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('uk_chunk_entity_links').on(table.entityId, table.chunkId)],
);
