/**
 * Drizzle schema for rag_query_logs.
 *
 * IMPORTANT: rag_query_logs is PARTITIONED BY RANGE (created_at) in Postgres.
 * Drizzle ORM does not support PARTITION BY in its schema DSL.
 * The SQL migration V17__add_rag_query_logs.sql is the authoritative definition
 * for partitioning, the default partition, and monthly partition creation.
 * This schema is a query-friendly TypeScript view used only for typed reads and
 * the RagTraceService INSERT (which uses raw SQL per the every-column rule).
 *
 * Same pattern as document_chunk_representations (T2.A).
 */
import { pgTable, uuid, varchar, text, jsonb, integer, timestamp } from 'drizzle-orm/pg-core';

export const ragQueryLogs = pgTable('rag_query_logs', {
  id: uuid('id').notNull().defaultRandom(),
  userId: uuid('user_id'),
  queryHash: varchar('query_hash', { length: 64 }).notNull(),
  queryPreview: text('query_preview'),
  queryClass: varchar('query_class', { length: 32 }),
  variants: jsonb('variants')
    .$type<Array<{ kind: string; query_hash: string }>>()
    .notNull()
    .default([]),
  filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
  lanes: varchar('lanes', { length: 32 }).array().notNull().default([]),
  resultChunkIds: uuid('result_chunk_ids').array().notNull().default([]),
  laneCounts: jsonb('lane_counts').$type<Record<string, number>>().notNull().default({}),
  timingsMs: jsonb('timings_ms').$type<Record<string, number>>().notNull().default({}),
  fallbackFlags: varchar('fallback_flags', { length: 64 }).array().notNull().default([]),
  rerankReason: varchar('rerank_reason', { length: 32 }),
  totalMs: integer('total_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
