import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { TradingRuntimeConfig } from '../../config/trading.config';
import { OrderLedgerService } from '../order-ledger/order-ledger.service';
import { BrokerRegistry } from '../broker-registry.service';
import type { OrderLedgerRow } from '@finsentinel/db';
import type { IBroker } from '../interfaces/broker';

/**
 * Item 3 M3 — order_ledger reconciler.
 *
 * The state machine in M2 inserts EXECUTING rows BEFORE deleting pending and
 * BEFORE broker calls (durable-first ordering, see fix `4fccae4`). A process
 * crash between INSERT and the broker call (or between the broker call and
 * `transitionFromExecuting`) leaves rows stuck in EXECUTING. This service is
 * the cron tick that resolves them.
 *
 * Behavior:
 *   1. Scan order_ledger for status='EXECUTING' AND updated_at older than
 *      `staleAfterMs` (default 60s). Capped to a per-tick batch size to
 *      bound load when the backlog spikes.
 *   2. For each row:
 *      - paper broker → no broker-side status to query →
 *        UNKNOWN_REQUIRES_OPERATOR_REVIEW with errorReason explaining.
 *      - missing broker_order_id → can't ask the broker by id →
 *        UNKNOWN_REQUIRES_OPERATOR_REVIEW.
 *      - broker not registered (disabled in this deploy) → leave EXECUTING,
 *        log WARN. Operators can retry after enabling the broker.
 *      - broker.queryOrderStatus undefined → UNKNOWN.
 *      - broker says filled → EXECUTED with response.
 *      - broker says rejected → FAILED with errorReason from broker.
 *      - broker says pending → leave EXECUTING but bump updated_at to
 *        deprioritize on the next tick.
 *      - broker says unknown / throws → UNKNOWN_REQUIRES_OPERATOR_REVIEW.
 *
 * Feature flag: `TRADING_LEDGER_RECONCILER_ENABLED`. Default OFF — when off
 * the @Cron handler short-circuits before any DB or broker call so deploys
 * that haven't enabled the M2 state machine pay zero overhead. Required to
 * be ON before flipping `TRADING_STATE_MACHINE_ENABLED` in production —
 * without the reconciler, stuck EXECUTING rows pile up indefinitely.
 *
 * See:
 *   docs/exec-plans/2026-04-24-trading-order-ledger-state-machine.md §8
 */
@Injectable()
export class LedgerReconcilerService {
  private readonly logger = new Logger(LedgerReconcilerService.name);

  /** Default per-tick scan limit. */
  private static readonly BATCH_LIMIT = 100;

  constructor(
    private readonly orderLedger: OrderLedgerService,
    private readonly brokerRegistry: BrokerRegistry,
    private readonly config: ConfigService,
  ) {}

  /**
   * @Cron tick. Reads the flag once and short-circuits if off so we're not
   * paying a flag check + Logger call per tick when the feature is dormant.
   *
   * The tick interval is fixed at the cron expression below; the service
   * exposes the configurable `staleAfterMs` and `batchLimit` for the per-tick
   * scan. If a deployment wants a different tick cadence, change the cron
   * expression and ship a separate PR with that decision recorded.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    const cfg = this.tradingCfg();
    if (!cfg.reconcilerEnabled) return;

    try {
      await this.scan();
    } catch (err) {
      // Cron handlers swallow rejections — surface explicitly.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Reconciler tick failed: ${msg}`);
    }
  }

  /**
   * One scan pass. Public so operators can trigger a reconcile from an
   * admin script without waiting for the cron tick — same pattern as
   * DocumentReconcilerService.runOnce().
   */
  async scan(): Promise<{
    scanned: number;
    executed: number;
    failed: number;
    pending: number;
    unknown: number;
    skippedNoBroker: number;
  }> {
    const cfg = this.tradingCfg();
    const stuck = await this.orderLedger.findStuckExecuting(
      cfg.reconcilerStaleAfterMs,
      LedgerReconcilerService.BATCH_LIMIT,
    );

    const summary = {
      scanned: stuck.length,
      executed: 0,
      failed: 0,
      pending: 0,
      unknown: 0,
      skippedNoBroker: 0,
    };
    if (stuck.length === 0) return summary;

    for (const row of stuck) {
      const outcome = await this.resolveOne(row);
      switch (outcome) {
        case 'executed':
          summary.executed += 1;
          break;
        case 'failed':
          summary.failed += 1;
          break;
        case 'pending':
          summary.pending += 1;
          break;
        case 'unknown':
          summary.unknown += 1;
          break;
        case 'skipped':
          summary.skippedNoBroker += 1;
          break;
      }
    }

    this.logger.log(
      `Reconciler scan: scanned=${summary.scanned} executed=${summary.executed} failed=${summary.failed} pending=${summary.pending} unknown=${summary.unknown} skipped=${summary.skippedNoBroker}`,
    );
    return summary;
  }

  /**
   * Resolve one stuck row. Returns the bucket the row landed in for the
   * scan summary; the actual transition is applied via OrderLedgerService.
   *
   * 'skipped' = broker not registered; row left as EXECUTING for the next
   * tick (operator may need to enable the broker first).
   */
  private async resolveOne(row: OrderLedgerRow): Promise<
    'executed' | 'failed' | 'pending' | 'unknown' | 'skipped'
  > {
    // Paper rows can't be queried; they're operator-review.
    if (row.broker === 'paper') {
      await this.orderLedger.applyReconcilerOutcome(row.id, {
        kind: 'unknown',
        errorReason:
          'Paper broker has no order-status endpoint; row was stuck in EXECUTING and cannot be auto-resolved',
      });
      return 'unknown';
    }

    if (!row.brokerOrderId) {
      await this.orderLedger.applyReconcilerOutcome(row.id, {
        kind: 'unknown',
        errorReason:
          'No broker_order_id recorded — process likely crashed before broker.placeOrder returned an id',
      });
      return 'unknown';
    }

    const broker = this.brokerRegistry.findLiveBrokerById(row.broker);
    if (!broker) {
      this.logger.warn(
        `Reconciler: broker '${row.broker}' not registered; leaving row ${row.id.slice(0, 8)}... in EXECUTING for next tick`,
      );
      return 'skipped';
    }

    if (!broker.queryOrderStatus) {
      await this.orderLedger.applyReconcilerOutcome(row.id, {
        kind: 'unknown',
        errorReason: `Broker '${row.broker}' does not implement queryOrderStatus`,
      });
      return 'unknown';
    }

    let result: Awaited<ReturnType<NonNullable<IBroker['queryOrderStatus']>>>;
    try {
      result = await broker.queryOrderStatus(row.brokerOrderId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.orderLedger.applyReconcilerOutcome(row.id, {
        kind: 'unknown',
        errorReason: `Broker queryOrderStatus threw: ${msg}`,
      });
      return 'unknown';
    }

    switch (result.status) {
      case 'filled': {
        const update: Parameters<typeof this.orderLedger.applyReconcilerOutcome>[1] = {
          kind: 'executed',
          brokerOrderId: row.brokerOrderId,
        };
        if (result.filledQty != null) update.filledQty = result.filledQty;
        if (result.avgPrice != null) update.avgPrice = result.avgPrice;
        await this.orderLedger.applyReconcilerOutcome(row.id, update);
        return 'executed';
      }
      case 'rejected':
        await this.orderLedger.applyReconcilerOutcome(row.id, {
          kind: 'failed',
          brokerOrderId: row.brokerOrderId,
          errorReason: result.errorReason ?? 'Broker rejected order (no reason provided)',
        });
        return 'failed';
      case 'pending':
        await this.orderLedger.applyReconcilerOutcome(row.id, { kind: 'pending' });
        return 'pending';
      case 'unknown':
      default:
        await this.orderLedger.applyReconcilerOutcome(row.id, {
          kind: 'unknown',
          errorReason: result.errorReason ?? `Broker returned unknown status for ${row.brokerOrderId}`,
        });
        return 'unknown';
    }
  }

  private tradingCfg(): {
    reconcilerEnabled: boolean;
    reconcilerStaleAfterMs: number;
  } {
    const cfg = this.config?.get<TradingRuntimeConfig>('trading');
    return {
      reconcilerEnabled: cfg?.reconcilerEnabled ?? false,
      reconcilerStaleAfterMs: cfg?.reconcilerStaleAfterMs ?? 60_000,
    };
  }
}
