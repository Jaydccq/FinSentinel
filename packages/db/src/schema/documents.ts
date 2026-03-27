import { pgTable, uuid, varchar, bigint, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  originalFileName: varchar('original_file_name', { length: 255 }).notNull(),
  docType: varchar('doc_type', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('PENDING'),
  sector: varchar('sector', { length: 255 }),
  regionId: varchar('region_id', { length: 10 }).default('US'),
  userId: uuid('user_id').references(() => users.id),
  fileSize: bigint('file_size', { mode: 'number' }),
  chunkCount: integer('chunk_count'),
  storageKey: varchar('storage_key', { length: 255 }),
  storageTier: varchar('storage_tier', { length: 50 }).notNull().default('HOT'),
  archivedAt: timestamp('archived_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_documents_user_id').on(table.userId),
]);
