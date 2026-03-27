import { pgTable, uuid, boolean, integer, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const agentHeartbeatConfigs = pgTable('agent_heartbeat_configs', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  enabled: boolean('enabled').notNull().default(true),
  intervalSeconds: integer('interval_seconds').notNull().default(600),
  drawdownAlertPct: numeric('drawdown_alert_pct', { precision: 5, scale: 2 }).notNull().default('10.00'),
  lastBeatAt: timestamp('last_beat_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_agent_heartbeat_enabled_last_beat').on(table.enabled, table.lastBeatAt),
]);
