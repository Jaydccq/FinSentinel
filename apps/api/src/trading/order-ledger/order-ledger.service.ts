import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import {
  orderLedger,
  type DrizzleDB,
  type OrderLedgerRow,
  type OrderLedgerStatus,
} from '@finsentinel/db';

/**
 * Operation result as produced by UnifiedTradingService.execute().
 * Kept structural to avoid pulling the full broker-result type chain.
 */
export interface ExecutedOperation {
  symbol: unknown;
  action: unknown;
  success: boolean;
  filledQty?: unknown;
  avgPrice?: unknown;
  errorMessage?: string;
  qty?: unknown;
  amount?: unknown;
}

export interface RecordExecutionInput {
  userId: string;
  commitHash: string;
  idempotencyKey?: string;
  broker: 'paper' | 'alpaca' | 'okx' | 'ccxt' | string;
  operations: ExecutedOperation[];
}

/**
 * Persistent per-operation execution log for the trading subsystem (M1).
 *
 * Scope: ADDITIVE ONLY. Dual-written alongside the existing
 * wallet.commitHistory write in UnifiedTradingService.execute(). The
 * legacy wallet path remains the system of record. M2 (separate PRD
 * milestone) flips the system of record and introduces the full state
 * machine; M3 adds the reconciler.
 *
 * Failure-mode contract: a write failure here MUST NOT abort the
 * trading flow. Callers wrap recordExecutionResults() in try/catch and
 * log a warning. The trade history and wallet remain authoritative
 * during the M1 dual-write window.
 *
 * See:
 * - PRD: docs/exec-plans/2026-04-24-trading-order-ledger-state-machine.md
 * - Migration: packages/db/migrations/V23__order_ledger.sql
 */
@Injectable()
export class OrderLedgerService {
  private readonly logger = new Logger(OrderLedgerService.name);

  constructor(@Inject('DRIZZLE_DB') private readonly db: DrizzleDB) {}

  /**
   * Insert one row per executed operation. Each operation gets the
   * commit hash so all rows for a single commit can be retrieved
   * together.
   */
  async recordExecutionResults(input: RecordExecutionInput): Promise<void> {
    const now = new Date();
    const rows = input.operations.map((op) => {
      const status: OrderLedgerStatus = op.success ? 'EXECUTED' : 'FAILED';
      const symbol = op.symbol == null ? '' : String(op.symbol);
      const side = this.deriveSide(op.action);
      return {
        id: randomUUID(),
        userId: input.userId,
        commitHash: input.commitHash,
        idempotencyKey: input.idempotencyKey ?? null,
        status,
        symbol,
        side,
        qty: op.qty != null ? String(op.qty) : op.filledQty != null ? String(op.filledQty) : null,
        amount: op.amount != null ? String(op.amount) : null,
        price: op.avgPrice != null ? String(op.avgPrice) : null,
        broker: input.broker,
        brokerOrderId: null,
        brokerRequest: { symbol, action: op.action, qty: op.qty, amount: op.amount } as Record<
          string,
          unknown
        >,
        brokerResponse: op.success
          ? ({
              filledQty: op.filledQty,
              avgPrice: op.avgPrice,
            } as Record<string, unknown>)
          : null,
        errorReason: op.errorMessage ?? null,
        createdAt: now,
        updatedAt: now,
      };
    });

    if (rows.length === 0) return;
    await this.db.insert(orderLedger).values(rows);
    this.logger.log(
      `order_ledger dual-write user=${input.userId} commit=${input.commitHash.substring(0, 8)}... rows=${rows.length}`,
    );
  }

  /**
   * Idempotency lookup. Returns the most recent ledger rows for the
   * (user, idempotency_key) pair, or [] if none. M2 will use this as
   * the durable idempotency check that survives Redis eviction.
   */
  async findByIdempotency(userId: string, idempotencyKey: string): Promise<OrderLedgerRow[]> {
    return this.db
      .select()
      .from(orderLedger)
      .where(and(eq(orderLedger.userId, userId), eq(orderLedger.idempotencyKey, idempotencyKey)))
      .orderBy(desc(orderLedger.createdAt));
  }

  async findByCommitHash(commitHash: string): Promise<OrderLedgerRow[]> {
    return this.db
      .select()
      .from(orderLedger)
      .where(eq(orderLedger.commitHash, commitHash))
      .orderBy(desc(orderLedger.createdAt));
  }

  private deriveSide(action: unknown): string {
    const a = String(action ?? '').toLowerCase();
    if (a === 'sell' || a === 'close') return 'sell';
    return 'buy';
  }
}
