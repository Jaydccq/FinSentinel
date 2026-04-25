import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const userInvestmentProfiles = pgTable(
  'user_investment_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id),
    workingMemory: text('working_memory'),
    riskTolerance: varchar('risk_tolerance', { length: 20 }),
    investmentHorizon: varchar('investment_horizon', { length: 20 }),
    currentSentiment: varchar('current_sentiment', { length: 30 }),
    sentimentReason: text('sentiment_reason'),
    preferences: jsonb('preferences').$type<Record<string, unknown>>().default({}),
    stateHistory: jsonb('state_history').$type<unknown[]>().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('idx_user_investment_profiles_user_id').on(table.userId)],
);
