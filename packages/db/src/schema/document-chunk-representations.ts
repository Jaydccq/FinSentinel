import {
  customType,
  pgTable,
  uuid,
  varchar,
  text,
  real,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const REPRESENTATION_TYPES = [
  'contextual_text',
  'sample_question',
  'summary',
  'keyword_entity',
] as const;

export type RepresentationType = typeof REPRESENTATION_TYPES[number];

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

export const documentChunkRepresentations = pgTable(
  'document_chunk_representations',
  {
    id: uuid('id').primaryKey(),
    chunkId: uuid('chunk_id').notNull(),
    representationType: varchar('representation_type', { length: 32 })
      .notNull()
      .$type<RepresentationType>(),
    content: text('content').notNull(),
    embedding: vector('embedding'),
    searchVector: tsvectorType('search_vector'),
    weight: real('weight').notNull().default(1.0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_dcr_chunk_type').on(table.chunkId, table.representationType),
    // HNSW operator opclass is set in the SQL migration; Drizzle records the index for schema awareness only
    index('idx_dcr_embedding_hnsw').on(table.embedding),
    index('idx_dcr_search_vector').on(table.searchVector),
  ],
);
