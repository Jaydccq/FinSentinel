import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { watchlistCategories } from './watchlist-categories';

export const watchlistItems = pgTable(
  'watchlist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => watchlistCategories.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 20 }).notNull(),
    companyName: varchar('company_name', { length: 200 }),
    thesis: text('thesis'),
    notes: text('notes'),
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uk_watchlist_items_category_symbol').on(table.categoryId, table.symbol),
    index('idx_watchlist_items_user_id').on(table.userId),
    index('idx_watchlist_items_category_id').on(table.categoryId),
  ],
);
