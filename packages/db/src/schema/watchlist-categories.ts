import { pgTable, uuid, varchar, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

export const watchlistCategories = pgTable('watchlist_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  name: varchar('name', { length: 80 }).notNull(),
  key: varchar('category_key', { length: 100 }).notNull(),
  description: varchar('description', { length: 255 }),
  summary: text('summary'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uk_watchlist_categories_user_key').on(table.userId, table.key),
  index('idx_watchlist_categories_user_id').on(table.userId),
]);
