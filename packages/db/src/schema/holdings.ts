import { pgTable, uuid, varchar, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import { portfolios } from './portfolios';

export const holdings = pgTable('holdings', {
  id: uuid('id').primaryKey().defaultRandom(),
  portfolioId: uuid('portfolio_id').notNull().references(() => portfolios.id),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  companyName: varchar('company_name', { length: 200 }),
  quantity: numeric('quantity', { precision: 15, scale: 6 }).notNull(),
  averageCost: numeric('average_cost', { precision: 15, scale: 2 }).notNull(),
  currentPrice: numeric('current_price', { precision: 15, scale: 2 }),
  sector: varchar('sector', { length: 50 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('idx_holdings_portfolio_id').on(table.portfolioId),
]);
