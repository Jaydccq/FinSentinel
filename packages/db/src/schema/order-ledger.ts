import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

/**
 * Persistent per-operation execution log for the trading subsystem.
 * See migration V23 and PRD
 * docs/exec-plans/2026-04-24-trading-order-ledger-state-machine.md.
 *
 * M1 contract: additive only — the unified-trading service writes a row
 * for every executed/failed operation alongside the existing wallet
 * commitHistory write. M2 will flip the system of record to this table
 * and introduce the full STAGED → COMMITTED → EXECUTING → EXECUTED /
 * PARTIALLY_FAILED / FAILED / CANCELLED state machine.
 *
 * Decimal-string columns (qty, amount, price) follow the convention
 * established in the decimal-money-migration PRD §4.6: broker adapters
 * emit decimal strings; arithmetic happens in Decimal; persistence is
 * canonicalized via .toFixed(8).
 */
export const orderLedger = pgTable(
  'order_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    commitHash: varchar('commit_hash', { length: 64 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    status: varchar('status', { length: 32 }).notNull(),
    symbol: varchar('symbol', { length: 64 }).notNull(),
    side: varchar('side', { length: 8 }).notNull(),
    qty: varchar('qty', { length: 64 }),
    amount: varchar('amount', { length: 64 }),
    price: varchar('price', { length: 64 }),
    broker: varchar('broker', { length: 32 }).notNull(),
    brokerOrderId: varchar('broker_order_id', { length: 128 }),
    brokerRequest: jsonb('broker_request')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    brokerResponse: jsonb('broker_response').$type<Record<string, unknown> | null>(),
    errorReason: text('error_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('order_ledger_user_created_idx').on(table.userId, table.createdAt.desc()),
    index('order_ledger_commit_hash_idx').on(table.commitHash),
    index('order_ledger_idempotency_idx')
      .on(table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    index('order_ledger_broker_status_idx').on(table.broker, table.status),
  ],
);

export type OrderLedgerRow = typeof orderLedger.$inferSelect;
export type NewOrderLedgerRow = typeof orderLedger.$inferInsert;

/**
 * Status enum kept in sync with the SQL CHECK constraint in V23 + V24.
 * V24 adds UNKNOWN_REQUIRES_OPERATOR_REVIEW for the M3 reconciler.
 */
export const ORDER_LEDGER_STATUSES = [
  'STAGED',
  'COMMITTED',
  'EXECUTING',
  'EXECUTED',
  'PARTIALLY_FAILED',
  'FAILED',
  'CANCELLED',
  // V24: reconciler terminal status for rows where the broker could not
  // give a definitive answer (e.g., no broker_order_id, or broker says
  // 'unknown'/404). Operator must resolve manually.
  'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
] as const;

export type OrderLedgerStatus = (typeof ORDER_LEDGER_STATUSES)[number];
