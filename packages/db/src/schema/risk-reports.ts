import { pgTable, uuid, integer, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { portfolios } from './portfolios';

export const riskReports = pgTable('risk_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  portfolioId: uuid('portfolio_id').notNull().references(() => portfolios.id),
  riskScore: integer('risk_score').notNull(),
  riskLevel: varchar('risk_level', { length: 50 }).notNull(),
  summary: text('summary'),
  factorsJson: jsonb('factors_json'),
  adviceJson: jsonb('advice_json'),
  disclaimer: text('disclaimer'),
  regulatoryFramework: varchar('regulatory_framework', { length: 255 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_risk_reports_portfolio_id').on(table.portfolioId),
]);
