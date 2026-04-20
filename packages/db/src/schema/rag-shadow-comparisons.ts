import { pgTable, uuid, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const ragShadowComparisons = pgTable('rag_shadow_comparisons', {
  id: uuid('id').primaryKey().defaultRandom(),
  queryHash: text('query_hash').notNull(),
  queryClass: text('query_class').notNull(),
  singleStageChunkIds: text('single_stage_chunk_ids').array().notNull().default([]),
  multiStageChunkIds: text('multi_stage_chunk_ids').array().notNull().default([]),
  singleStageLatencyMs: integer('single_stage_latency_ms'),
  multiStageLatencyMs: integer('multi_stage_latency_ms'),
  shadowTimedOut: boolean('shadow_timed_out').notNull().default(false),
  shadowDroppedBackpressure: boolean('shadow_dropped_backpressure').notNull().default(false),
  multiStageError: text('multi_stage_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_rag_shadow_comparisons_created_at').on(table.createdAt),
  index('idx_rag_shadow_comparisons_query_class').on(table.queryClass, table.createdAt),
]);
