import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, and, desc, lt, inArray } from 'drizzle-orm';
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

  // ───────────────────────────────────────────────────────────────────────
  // M2 — state machine transition methods
  // ───────────────────────────────────────────────────────────────────────
  // Used by UnifiedTradingService.execute() when TRADING_STATE_MACHINE_ENABLED
  // is on. Inserts EXECUTING rows BEFORE broker calls, then transitions each
  // to EXECUTED/FAILED based on outcome. The op-index in the request payload
  // pins which row corresponds to which operation so we can transition by id.

  /**
   * Insert one EXECUTING row per operation. Returns the row IDs in the same
   * order as `input.operations` so the caller can pair each broker outcome
   * back to its row for the EXECUTING → EXECUTED/FAILED transition.
   */
  async recordExecuting(input: {
    userId: string;
    commitHash: string;
    idempotencyKey?: string;
    broker: string;
    operations: { symbol: unknown; action: unknown; qty?: unknown; amount?: unknown }[];
  }): Promise<string[]> {
    if (input.operations.length === 0) return [];

    const now = new Date();
    const rowsWithIds = input.operations.map((op) => {
      const symbol = op.symbol == null ? '' : String(op.symbol);
      return {
        id: randomUUID(),
        userId: input.userId,
        commitHash: input.commitHash,
        idempotencyKey: input.idempotencyKey ?? null,
        status: 'EXECUTING' as OrderLedgerStatus,
        symbol,
        side: this.deriveSide(op.action),
        qty: op.qty != null ? String(op.qty) : null,
        amount: op.amount != null ? String(op.amount) : null,
        price: null,
        broker: input.broker,
        brokerOrderId: null,
        brokerRequest: { symbol, action: op.action, qty: op.qty, amount: op.amount } as Record<
          string,
          unknown
        >,
        brokerResponse: null,
        errorReason: null,
        createdAt: now,
        updatedAt: now,
      };
    });

    await this.db.insert(orderLedger).values(rowsWithIds);
    this.logger.log(
      `order_ledger EXECUTING user=${input.userId} commit=${input.commitHash.substring(0, 8)}... rows=${rowsWithIds.length}`,
    );
    return rowsWithIds.map((r) => r.id);
  }

  /**
   * Transition each EXECUTING row to EXECUTED or FAILED based on outcomes.
   * `rowIds[i]` corresponds to `outcomes[i]` — caller must preserve order.
   */
  async transitionFromExecuting(
    rowIds: string[],
    outcomes: ExecutedOperation[],
  ): Promise<void> {
    if (rowIds.length === 0) return;
    if (rowIds.length !== outcomes.length) {
      throw new Error(
        `transitionFromExecuting: rowIds.length=${rowIds.length} != outcomes.length=${outcomes.length}`,
      );
    }
    const now = new Date();
    // Drizzle doesn't expose a batch-update-with-different-values helper that
    // reliably maps to one round-trip without raw SQL, so issue per-row
    // updates. The cardinality is bounded by MAX_COMMIT_HISTORY (100), and
    // updates are by primary key so each is O(1).
    for (let i = 0; i < rowIds.length; i += 1) {
      const op = outcomes[i]!;
      const status: OrderLedgerStatus = op.success ? 'EXECUTED' : 'FAILED';
      await this.db
        .update(orderLedger)
        .set({
          status,
          price: op.avgPrice != null ? String(op.avgPrice) : null,
          brokerResponse: op.success
            ? ({
                filledQty: op.filledQty,
                avgPrice: op.avgPrice,
              } as Record<string, unknown>)
            : null,
          errorReason: op.errorMessage ?? null,
          updatedAt: now,
        })
        .where(eq(orderLedger.id, rowIds[i]!));
    }
  }

  /**
   * Bulk-set status for a list of rows (used to mark all as FAILED if the
   * pre-broker validation barfed before any individual op was attempted).
   */
  async transitionAll(
    rowIds: string[],
    status: OrderLedgerStatus,
    errorReason: string,
  ): Promise<void> {
    if (rowIds.length === 0) return;
    await this.db
      .update(orderLedger)
      .set({ status, errorReason, updatedAt: new Date() })
      .where(inArray(orderLedger.id, rowIds));
  }

  // ───────────────────────────────────────────────────────────────────────
  // M3 — reconciler scan
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Return rows stuck in EXECUTING longer than `staleAfterMs`. Capped to
   * `limit` rows so a per-tick scan is bounded under backlog. Ordered by
   * updated_at ASC so the oldest stuck rows are resolved first.
   */
  async findStuckExecuting(staleAfterMs: number, limit: number): Promise<OrderLedgerRow[]> {
    const cutoff = new Date(Date.now() - staleAfterMs);
    return this.db
      .select()
      .from(orderLedger)
      .where(and(eq(orderLedger.status, 'EXECUTING'), lt(orderLedger.updatedAt, cutoff)))
      .orderBy(orderLedger.updatedAt)
      .limit(limit);
  }

  /**
   * Apply a single reconciler outcome to one row. Used by LedgerReconcilerService
   * to fan transitions across many rows in a per-tick batch.
   *
   * - 'pending' is the no-op heartbeat: bump updated_at so the same row isn't
   *   re-scanned on the next tick.
   * - 'unknown' parks the row for operator review; once a row enters this
   *   state the reconciler ignores it (status filter excludes it).
   */
  async applyReconcilerOutcome(
    rowId: string,
    outcome:
      | { kind: 'executed'; brokerOrderId?: string; filledQty?: string; avgPrice?: string }
      | { kind: 'failed'; brokerOrderId?: string; errorReason: string }
      | { kind: 'pending' }
      | { kind: 'unknown'; errorReason: string },
  ): Promise<void> {
    const now = new Date();
    if (outcome.kind === 'pending') {
      // Heartbeat-only: re-stamp updated_at without changing status so we
      // won't re-scan this row immediately, but it stays an EXECUTING row
      // for the next tick.
      await this.db
        .update(orderLedger)
        .set({ updatedAt: now })
        .where(eq(orderLedger.id, rowId));
      return;
    }

    if (outcome.kind === 'executed') {
      await this.db
        .update(orderLedger)
        .set({
          status: 'EXECUTED',
          brokerOrderId: outcome.brokerOrderId ?? null,
          price: outcome.avgPrice ?? null,
          brokerResponse: {
            filledQty: outcome.filledQty,
            avgPrice: outcome.avgPrice,
            reconciled: true,
          } as Record<string, unknown>,
          errorReason: null,
          updatedAt: now,
        })
        .where(eq(orderLedger.id, rowId));
      return;
    }

    if (outcome.kind === 'failed') {
      await this.db
        .update(orderLedger)
        .set({
          status: 'FAILED',
          brokerOrderId: outcome.brokerOrderId ?? null,
          errorReason: outcome.errorReason,
          brokerResponse: { reconciled: true } as Record<string, unknown>,
          updatedAt: now,
        })
        .where(eq(orderLedger.id, rowId));
      return;
    }

    // 'unknown'
    await this.db
      .update(orderLedger)
      .set({
        status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
        errorReason: outcome.errorReason,
        brokerResponse: { reconciled: true, requiresOperatorReview: true } as Record<
          string,
          unknown
        >,
        updatedAt: now,
      })
      .where(eq(orderLedger.id, rowId));
  }

  private deriveSide(action: unknown): string {
    const a = String(action ?? '').toLowerCase();
    if (a === 'sell' || a === 'close') return 'sell';
    return 'buy';
  }
}
