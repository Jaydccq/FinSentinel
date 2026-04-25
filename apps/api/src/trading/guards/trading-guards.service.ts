import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { and, eq, gte } from 'drizzle-orm';
import { Decimal } from '@finsentinel/shared';
import { orderLedger, type DrizzleDB } from '@finsentinel/db';
import type { TradingRuntimeConfig } from '../../config/trading.config';

/**
 * Item 5 — live-trading guards (server-side).
 *
 * Three layers, applied in order before any LIVE-mode broker call:
 *   1. Kill switch — operator-set Redis flag `trading:kill_switch`. While
 *      set (any TTL or persistent), all LIVE orders fail fast. This is
 *      operationally toggleable WITHOUT a redeploy.
 *   2. Per-order notional cap — reject any single op whose USD-equivalent
 *      notional exceeds `TRADING_LIVE_PER_ORDER_NOTIONAL_USD`.
 *   3. Per-day per-user cumulative notional cap — sum of EXECUTED ledger
 *      rows since UTC midnight, vs `TRADING_LIVE_PER_DAY_NOTIONAL_USD`.
 *      0 means "no cap"; > 0 enforces.
 *
 * PAPER mode is intentionally NOT guarded — the whole point of paper is
 * to let users blow up an imaginary account; the guards are a real-money
 * spend ceiling.
 *
 * When `TRADING_LIVE_GUARDS_ENABLED=false` (default) `preflight()` returns
 * immediately, so deploys that haven't opted in pay zero overhead.
 *
 * Errors:
 *   - Kill switch active → HTTP 503 (Service Unavailable). Reason: operator
 *     halted trading; this is an availability statement, not a permanent
 *     reject. Clients can retry once the switch is cleared.
 *   - Per-order or per-day breach → HTTP 403 (Forbidden). Reason: this
 *     account, today, cannot place that order; clients should NOT retry.
 *
 * NOT IN SCOPE for this milestone (queued for follow-up):
 *   - Per-asset exposure cap (max % of account in one symbol).
 *   - Max-slippage check at order placement time.
 *   - Market-hours / asset-tradability check (defer to broker.canHandle +
 *     broker.getMarketClock — already in the IBroker contract).
 *   - Two-step confirmation on first LIVE switch (UI concern, not server).
 *   - Audit-trail event sink (separate AgentEvent.TRADE_GUARD_BLOCKED type
 *     to be added once we wire item 14 audit log).
 */

const KILL_SWITCH_KEY = 'trading:kill_switch';

interface PreflightInput {
  userId: string;
  /**
   * Operations from the staged commit. Each must carry `symbol`, `action`,
   * and ONE of `qty` / `amount`. `qty * indicativePrice` is used when
   * amount is missing — the indicative price comes from the engine quote
   * lookup the caller already does.
   */
  operations: Array<{
    symbol: unknown;
    action: unknown;
    qty?: unknown;
    amount?: unknown;
    indicativePrice?: unknown;
  }>;
}

@Injectable()
export class TradingGuardsService {
  private readonly logger = new Logger(TradingGuardsService.name);

  constructor(
    @Inject('REDIS') private readonly redis: Redis,
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly config: ConfigService,
  ) {}

  /**
   * Run all live-mode pre-flight checks. Throws on any breach. Returns
   * silently when the flag is off OR when all checks pass.
   *
   * Caller invokes only on the LIVE-mode branch of execute().
   */
  async preflight(input: PreflightInput): Promise<void> {
    const cfg = this.tradingCfg();
    if (!cfg.liveGuardsEnabled) return;

    // 1. Kill switch — cheapest check, runs first.
    const killed = await this.redis.exists(KILL_SWITCH_KEY);
    if (killed) {
      this.logger.warn(
        `Live trading blocked by kill switch user=${input.userId} ops=${input.operations.length}`,
      );
      throw new HttpException(
        'Live trading is temporarily halted (kill switch is active). Try again later.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // 2. Per-order notional cap. Each op evaluated independently.
    if (cfg.livePerOrderNotionalUsd > 0) {
      for (const op of input.operations) {
        const notional = this.opNotional(op);
        if (notional == null) {
          // Can't price — fail closed. Better to block an unpriceable order
          // than silently approve.
          throw new ForbiddenException(
            `Cannot determine notional for op ${String(op.symbol)} ${String(op.action)} — block live order until either qty+price or amount is provided`,
          );
        }
        if (notional.gt(cfg.livePerOrderNotionalUsd)) {
          throw new ForbiddenException(
            `Per-order notional cap exceeded: $${notional.toFixed(2)} > limit $${cfg.livePerOrderNotionalUsd}`,
          );
        }
      }
    }

    // 3. Per-day cumulative cap.
    if (cfg.livePerDayNotionalUsd > 0) {
      const todayUtcMidnight = new Date();
      todayUtcMidnight.setUTCHours(0, 0, 0, 0);

      const rows = await this.db
        .select({ qty: orderLedger.qty, amount: orderLedger.amount, price: orderLedger.price })
        .from(orderLedger)
        .where(
          and(
            eq(orderLedger.userId, input.userId),
            eq(orderLedger.status, 'EXECUTED'),
            gte(orderLedger.createdAt, todayUtcMidnight),
          ),
        );

      const todaySum = rows.reduce((acc, r) => {
        const n = this.rowNotional(r);
        return n ? acc.plus(n) : acc;
      }, new Decimal(0));

      const proposedSum = input.operations.reduce((acc, op) => {
        const n = this.opNotional(op);
        return n ? acc.plus(n) : acc;
      }, new Decimal(0));

      const total = todaySum.plus(proposedSum);
      if (total.gt(cfg.livePerDayNotionalUsd)) {
        throw new ForbiddenException(
          `Per-day notional cap would be exceeded: today=$${todaySum.toFixed(2)} + proposed=$${proposedSum.toFixed(2)} = $${total.toFixed(2)} > limit $${cfg.livePerDayNotionalUsd}`,
        );
      }
    }
  }

  /**
   * Operator API — set / clear / inspect the kill switch. Exposed as a
   * service method so an admin controller (separate PR) can wire it. Tests
   * also use this directly.
   */
  async setKillSwitch(reason: string, ttlSeconds?: number): Promise<void> {
    const value = JSON.stringify({ reason, setAt: new Date().toISOString() });
    if (ttlSeconds && ttlSeconds > 0) {
      await this.redis.setex(KILL_SWITCH_KEY, ttlSeconds, value);
    } else {
      await this.redis.set(KILL_SWITCH_KEY, value);
    }
    this.logger.warn(`Kill switch ENGAGED reason="${reason}" ttl=${ttlSeconds ?? 'persistent'}s`);
  }

  async clearKillSwitch(): Promise<void> {
    await this.redis.del(KILL_SWITCH_KEY);
    this.logger.warn('Kill switch CLEARED');
  }

  async killSwitchStatus(): Promise<{ engaged: boolean; reason?: string; setAt?: string }> {
    const raw = await this.redis.get(KILL_SWITCH_KEY);
    if (!raw) return { engaged: false };
    try {
      const parsed = JSON.parse(raw) as { reason?: string; setAt?: string };
      return { engaged: true, ...parsed };
    } catch {
      return { engaged: true };
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  /**
   * Compute notional for one staged op. Returns null when the op can't be
   * priced (no amount, no price, no indicative price) — caller decides
   * whether to fail-closed or skip.
   */
  private opNotional(op: PreflightInput['operations'][number]): InstanceType<typeof Decimal> | null {
    if (op.amount != null) {
      const a = this.toDecimal(op.amount);
      return a;
    }
    const qty = op.qty != null ? this.toDecimal(op.qty) : null;
    if (!qty) return null;
    const price = op.indicativePrice != null ? this.toDecimal(op.indicativePrice) : null;
    if (!price) return null;
    return qty.times(price);
  }

  /**
   * Compute notional for an executed ledger row. Same precedence as opNotional —
   * amount preferred, else qty * price. price column on the row is the avg
   * fill price written by transitionFromExecuting.
   */
  private rowNotional(row: {
    qty: string | null;
    amount: string | null;
    price: string | null;
  }): InstanceType<typeof Decimal> | null {
    if (row.amount) {
      const a = this.toDecimal(row.amount);
      return a;
    }
    if (row.qty && row.price) {
      const q = this.toDecimal(row.qty);
      const p = this.toDecimal(row.price);
      if (q && p) return q.times(p);
    }
    return null;
  }

  private toDecimal(input: unknown): InstanceType<typeof Decimal> | null {
    try {
      const d = new Decimal(String(input));
      if (!d.isFinite() || d.isNegative()) return null;
      return d;
    } catch {
      return null;
    }
  }

  private tradingCfg(): {
    liveGuardsEnabled: boolean;
    livePerOrderNotionalUsd: number;
    livePerDayNotionalUsd: number;
  } {
    const cfg = this.config?.get<TradingRuntimeConfig>('trading');
    return {
      liveGuardsEnabled: cfg?.liveGuardsEnabled ?? false,
      livePerOrderNotionalUsd: cfg?.livePerOrderNotionalUsd ?? 10_000,
      livePerDayNotionalUsd: cfg?.livePerDayNotionalUsd ?? 50_000,
    };
  }
}
