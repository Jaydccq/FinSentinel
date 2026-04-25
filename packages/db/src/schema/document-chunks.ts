import {
  customType,
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const tsvectorType = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'tsvector';
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return value as string;
  },
});

const vector = customType<{
  data: number[];
  driverData: string;
}>({
  dataType() {
    return 'vector';
  },
  toDriver(value) {
    return `[${value.join(',')}]`;
  },
  fromDriver(value) {
    return JSON.parse(value) as number[];
  },
});

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').primaryKey(),
    sourceType: varchar('source_type', { length: 20 }).notNull(),
    sourceId: uuid('source_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    metaTitle: text('meta_title'),
    metaSource: text('meta_source'),
    metaEntities: text('meta_entities'),
    searchVector: tsvectorType('search_vector'),
    parentId: uuid('parent_id'),
    sectionPath: text('section_path'),
    enrichmentStatus: varchar('enrichment_status', { length: 16 }).notNull().default('pending'),
  },
  (table) => [
    uniqueIndex('uk_document_chunks_source_chunk').on(
      table.sourceType,
      table.sourceId,
      table.chunkIndex,
    ),
    index('idx_document_chunks_source').on(table.sourceType, table.sourceId),
    index('idx_document_chunks_fts').on(table.searchVector),
  ],
);
