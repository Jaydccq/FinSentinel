import { pgTable, uuid, varchar, text, timestamp, jsonb, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const newsItems = pgTable('news_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: varchar('source_id', { length: 200 }).notNull(),
  source: varchar('source', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  summary: text('summary'),
  articleUrl: varchar('article_url', { length: 255 }),
  author: varchar('author', { length: 255 }),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  tickers: jsonb('tickers'),
  tags: jsonb('tags'),
  sentiment: varchar('sentiment', { length: 255 }),
  enriched: boolean('enriched').notNull().default(false),
  documentId: uuid('document_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uk_news_source_source_id').on(table.source, table.sourceId),
  index('idx_news_published_at').on(table.publishedAt.desc()),
  index('idx_news_enriched').on(table.enriched),
]);
