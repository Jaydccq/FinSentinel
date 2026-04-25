import { sql } from 'drizzle-orm';
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

export type RepresentationType = (typeof REPRESENTATION_TYPES)[number];

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
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_dcr_chunk_type').on(table.chunkId, table.representationType),
    // No idx_dcr_embedding_hnsw: canonical embedding is 2048-dim
    // (nvidia/llama-nemotron-embed-1b-v2) and pgvector HNSW caps at
    // 2000 dims. Dense representation-lane retrieval uses seq-scan;
    // revisit with IVFFlat at 100k+ representation rows.
    // SQL migration declares WHERE search_vector IS NOT NULL (partial GIN index); Drizzle does not support partial predicates here — sync work must preserve that predicate manually
    index('idx_dcr_search_vector').on(table.searchVector),
  ],
);
