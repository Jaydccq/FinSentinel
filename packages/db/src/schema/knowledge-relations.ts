import { pgTable, uuid, varchar, real, text, timestamp, index } from 'drizzle-orm/pg-core';

export const RELATION_TYPES = [
  'CEO_OF', 'BOARD_MEMBER_OF', 'FOUNDED_BY',
  'SUBSIDIARY_OF', 'ACQUIRED_BY', 'COMPETES_WITH',
  'SUPPLIES_TO', 'PARTNER_OF', 'INVESTED_IN',
  'BELONGS_TO_SECTOR', 'LISTED_ON',
  'FILED_BY', 'MENTIONED_IN',
  'TRIGGERED_BY', 'IMPACTS',
] as const;

export type RelationType = typeof RELATION_TYPES[number];

export const knowledgeRelations = pgTable('knowledge_relations', {
  id: uuid('id').primaryKey(),
  sourceEntityId: uuid('source_entity_id').notNull(),
  targetEntityId: uuid('target_entity_id').notNull(),
  relationType: varchar('relation_type', { length: 50 }).notNull(),
  confidence: real('confidence').notNull(),
  evidence: text('evidence'),
  sourceChunkId: uuid('source_chunk_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_knowledge_relations_source').on(table.sourceEntityId),
  index('idx_knowledge_relations_target').on(table.targetEntityId),
  index('idx_knowledge_relations_type').on(table.relationType),
]);
