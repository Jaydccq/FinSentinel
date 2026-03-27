import { pgTable, uuid, numeric, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const tradeWallets = pgTable('trade_wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  initialCapital: numeric('initial_capital', { precision: 15, scale: 2 }).notNull().default('100000.00'),
  cashBalance: numeric('cash_balance', { precision: 15, scale: 2 }).notNull().default('100000.00'),
  tradingMode: varchar('trading_mode', { length: 10 }).notNull().default('PAPER'),
  positions: jsonb('positions').$type<unknown[]>().default([]),
  commitHistory: jsonb('commit_history').$type<unknown[]>().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('idx_trade_wallets_user_id').on(table.userId),
]);
