import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type Redis from 'ioredis';
import { tradeWallets, eq } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { TradingMode, Contract, AgentEventType, SecurityType } from '@finsentinel/shared';
import type { AgentEventType as AgentEventTypeValue } from '@finsentinel/shared';
import type {
  UnifiedStageRequest,
  V2WalletResponse,
  V2CommitResponse,
  V2StagedResponse,
} from '@finsentinel/shared';
import { stableStringify } from '@finsentinel/shared/utils';
import { ConfigService } from '@nestjs/config';
import { BrokerRegistry } from './broker-registry.service';
import { PaperBroker } from './brokers/paper.broker';
import type { MarketDataService } from '../market/market-data.service';
import type { ExecuteResult } from './interfaces/execute-result';
import type { PositionMap, PositionMapString } from './engines/paper-trading.engine';
import { OrderLedgerService } from './order-ledger/order-ledger.service';
import { TradingGuardsService } from './guards/trading-guards.service';
import type { TradingRuntimeConfig } from '../config/trading.config';

// ── Constants ───────────────────────────────────────────────────────────────

const STAGING_KEY_PREFIX = 'uta:staging:';
const PENDING_KEY_PREFIX = 'uta:pending:';
const IDEM_COMMIT_KEY_PREFIX = 'uta:idem:';
const IDEM_EXEC_KEY_PREFIX = 'uta:executed:';
const STATE_TTL_SECONDS = 30 * 60; // 30 minutes
const MAX_COMMIT_HISTORY = 100;
const MAX_STAGING_SIZE = 50;
const DEFAULT_INITIAL_CAPITAL = '100000.00';

// ── Lua script for atomic append to staging ─────────────────────────────────

/**
 * Atomic append to a JSON array stored in a Redis key.
 *
 * KEYS[1] = staging key
 * ARGV[1] = maxSize
 * ARGV[2] = JSON-encoded item to append
 * ARGV[3] = TTL in seconds
 *
 * Returns: new array length, or -1 if full.
 *
 * This is the standard ioredis redis.eval() call for server-side Lua execution,
 * NOT JavaScript eval(). It is safe and standard practice for atomic Redis ops.
 */
const LUA_ATOMIC_APPEND = `
local key = KEYS[1]
local maxSize = tonumber(ARGV[1])
local item = ARGV[2]
local ttl = tonumber(ARGV[3])
local current = redis.call('GET', key)
local arr
if current then
  arr = cjson.decode(current)
else
  arr = {}
end
if #arr >= maxSize then
  return -1
end
table.insert(arr, cjson.decode(item))
redis.call('SET', key, cjson.encode(arr))
redis.call('EXPIRE', key, ttl)
return #arr
`;

/**
 * Atomic capture-and-clear of staging.
 *
 * KEYS[1] = staging key
 *
 * Returns: the staging payload as captured at script execution time, or nil
 * if staging is empty / missing.
 *
 * After this returns, staging is empty. Any concurrent stage() call that
 * lands later writes into a fresh staging area instead of being clobbered
 * by a separate del() — which is the race the original 3-call sequence had.
 */
const LUA_ATOMIC_COMMIT = `
local staging = redis.call('GET', KEYS[1])
if not staging or staging == '[]' then return nil end
redis.call('DEL', KEYS[1])
return staging
`;

// ── SHA-256 helper ──────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// ── Wallet row type (matches Drizzle schema) ────────────────────────────────

interface WalletRow {
  id: string;
  userId: string;
  initialCapital: string;
  cashBalance: string;
  tradingMode: string;
  positions: unknown[];
  commitHistory: unknown[];
  createdAt: Date;
  updatedAt: Date;
}

// ── Commit data structure ───────────────────────────────────────────────────

interface CommitData {
  hash: string;
  message: string;
  timestamp: string;
  operations: Record<string, unknown>[];
  metadata?: {
    ledgerId?: string;
    runId?: string;
  };
  idempotencyKey?: string;
}

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * UnifiedTradingService — core trading orchestration with stage/commit/execute lifecycle.
 *
 * Provides the unified trading lifecycle with:
 * - Phase 1: Stage operations into Redis (atomic Lua append, 30-min TTL)
 * - Phase 2: Commit staged ops (SHA-256 hash, store pending, clear staging)
 * - Phase 3: Execute pending commit (resolve broker, execute, persist wallet)
 *
 * Double-spend prevention: atomic get-and-delete of pending commit in Redis.
 * Idempotency: commit hash checked against wallet.commitHistory before execution.
 */
@Injectable()
export class UnifiedTradingService {
  private readonly logger = new Logger(UnifiedTradingService.name);

  constructor(
    private readonly brokerRegistry: BrokerRegistry,
    @Inject('REDIS') private readonly redis: Redis,
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    @Inject('MarketDataService') private readonly marketDataService: MarketDataService,
    private readonly orderLedger: OrderLedgerService,
    private readonly tradingGuards: TradingGuardsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Read the trading runtime config. The two M3-era flags
   * (`decimalExecuteEnabled`, `stateMachineEnabled`) default to false so
   * existing deployments behave byte-identically until explicitly opted in.
   * Returns null-safe defaults if the config provider isn't bound (test
   * harnesses that omit ConfigService).
   */
  private tradingFlags(): { decimalExecuteEnabled: boolean; stateMachineEnabled: boolean } {
    const cfg = this.config?.get<TradingRuntimeConfig>('trading');
    return {
      decimalExecuteEnabled: cfg?.decimalExecuteEnabled ?? false,
      stateMachineEnabled: cfg?.stateMachineEnabled ?? false,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1: Stage
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Stage an operation into the user's Redis staging area.
   *
   * Uses a Lua script for atomic read-check-append to prevent races.
   * The ioredis .eval() method sends Lua to the Redis server for execution.
   *
   * @returns The new staging count, or throws if staging is full.
   */
  async stage(userId: string, op: UnifiedStageRequest): Promise<number> {
    const key = STAGING_KEY_PREFIX + userId;
    const item = JSON.stringify(op);

    // ioredis eval() executes Lua on the Redis server (not JS eval)
    const result = (await this.redis.eval(
      LUA_ATOMIC_APPEND,
      1, // number of KEYS
      key, // KEYS[1]
      String(MAX_STAGING_SIZE), // ARGV[1]
      item, // ARGV[2]
      String(STATE_TTL_SECONDS), // ARGV[3]
    )) as number;

    if (result === -1) {
      throw new BadRequestException(
        `Staging area is full (max ${MAX_STAGING_SIZE} operations). Commit or clear before adding more.`,
      );
    }

    this.logger.log(
      `Staged operation for user ${userId}: ${op.action} ${op.symbol} (count: ${result})`,
    );
    return result;
  }

  /**
   * Read the current staging area for a user.
   */
  async getStagingArea(userId: string): Promise<Record<string, unknown>[]> {
    const key = STAGING_KEY_PREFIX + userId;
    const raw = await this.redis.get(key);

    if (!raw) return [];

    return JSON.parse(raw) as Record<string, unknown>[];
  }

  /**
   * Clear all staged operations for a user.
   */
  async clearStagingArea(userId: string): Promise<void> {
    const key = STAGING_KEY_PREFIX + userId;
    await this.redis.del(key);
    this.logger.log(`Cleared staging area for user ${userId}`);
  }

  /**
   * Return structured staging response (V2StagedResponse).
   */
  async getStagedStructured(userId: string): Promise<V2StagedResponse> {
    const ops = await this.getStagingArea(userId);
    return {
      operations: ops.map((op) => ({
        action: String(op.action ?? ''),
        symbol: String(op.symbol ?? ''),
        qty: String(op.qty ?? ''),
        amount: String(op.amount ?? ''),
        price: String(op.price ?? ''),
      })),
      count: ops.length,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2: Commit
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Commit all staged operations. Atomically captures staging via a Lua script
   * (no read-then-delete race), computes a deterministic SHA-256 hash from
   * `(idempotencyKey ?? autoKey) | stableStringify(ops) | message`, stores the
   * pending commit, and caches the idempotencyKey → hash mapping so client
   * retries see the same hash without re-promoting staging.
   *
   * @param idempotencyKey  Stripe-style header value resolved at the controller
   *                        boundary. Same key + same intent → same hash.
   */
  async commit(
    userId: string,
    message: string,
    metadata?: { ledgerId?: string; runId?: string },
    idempotencyKey?: string,
  ): Promise<{ hash: string; count: number }> {
    if (!message || message.trim().length === 0) {
      throw new BadRequestException('Commit message must not be blank');
    }

    const stagingKey = STAGING_KEY_PREFIX + userId;
    const pendingKey = PENDING_KEY_PREFIX + userId;
    const idemCacheKey = idempotencyKey
      ? IDEM_COMMIT_KEY_PREFIX + userId + ':' + idempotencyKey
      : null;

    // 1. Idempotency cache hit → return prior hash, do NOT touch staging.
    if (idemCacheKey) {
      const cachedHash = await this.redis.get(idemCacheKey);
      if (cachedHash) {
        const pendingRaw = await this.redis.get(pendingKey);
        const count = pendingRaw ? (JSON.parse(pendingRaw) as CommitData).operations.length : 0;
        this.logger.log(
          `Idempotent commit hit user=${userId} key=${idempotencyKey} hash=${cachedHash.substring(0, 8)}...`,
        );
        return { hash: cachedHash, count };
      }
    }

    // 2. Atomically capture and clear staging.
    const stagingRaw = (await this.redis.eval(LUA_ATOMIC_COMMIT, 1, stagingKey)) as string | null;

    if (!stagingRaw) {
      throw new BadRequestException('Nothing staged — stage operations before committing');
    }

    const ops = JSON.parse(stagingRaw) as Record<string, unknown>[];
    if (ops.length === 0) {
      throw new BadRequestException('Nothing staged — stage operations before committing');
    }

    // 3. Deterministic hash. autoKey covers callers that don't pass a header.
    const autoKey = `${userId}|${ops
      .map((o) => String((o as { clientOrderId?: string }).clientOrderId ?? ''))
      .filter(Boolean)
      .sort()
      .join(',')}`;
    const hashKey = idempotencyKey ?? autoKey;
    const hashInput = `${hashKey}|${stableStringify(ops)}|${message}`;
    const hash = sha256(hashInput);

    const commitData: CommitData = {
      hash,
      message,
      timestamp: new Date().toISOString(),
      operations: ops,
      ...(metadata ? { metadata } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };

    await this.redis.setex(pendingKey, STATE_TTL_SECONDS, JSON.stringify(commitData));

    if (idemCacheKey) {
      await this.redis.setex(idemCacheKey, STATE_TTL_SECONDS, hash);
    }

    this.logger.log(
      `Committed ${ops.length} op(s) user=${userId} hash=${hash.substring(0, 8)}... idem=${idempotencyKey ?? 'auto'}`,
    );

    return { hash, count: ops.length };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 3: Execute
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute the pending commit.
   *
   * 0. Idempotency: prior successful execute with same Idempotency-Key
   *    returns the cached ExecuteResult, no broker re-trigger.
   * 1. Atomic get-and-delete pending commit (Redis 6.2+ GETDEL)
   * 2. Idempotency check via wallet.commitHistory (older retries)
   * 3. For PAPER mode: create shared PaperBroker, sync state, execute, sync back
   * 4. Build execution report
   * 5. Add commit to wallet.commitHistory (capped at MAX_COMMIT_HISTORY)
   * 6. Persist wallet to DB
   * 7. Cache ExecuteResult by idempotencyKey for future retries
   * 8. Emit event (stub)
   */
  async execute(userId: string, idempotencyKey?: string): Promise<ExecuteResult> {
    const pendingKey = PENDING_KEY_PREFIX + userId;
    const execCacheKey = idempotencyKey
      ? IDEM_EXEC_KEY_PREFIX + userId + ':' + idempotencyKey
      : null;
    const flags = this.tradingFlags();

    // 0. Cache hit: prior successful execute returns the same ExecuteResult.
    if (execCacheKey) {
      const cachedRaw = await this.redis.get(execCacheKey);
      if (cachedRaw) {
        this.logger.log(`Idempotent execute hit user=${userId} key=${idempotencyKey}`);
        return JSON.parse(cachedRaw) as ExecuteResult;
      }
    }

    // 0b. Ledger-first idempotency check (M2 only). If we have terminal-state
    // ledger rows for this (user, idempotencyKey), the execute already
    // happened — surface 400 like the legacy commitHistory path does.
    // Hydrating the full ExecuteResult from rows is M3 territory; for now we
    // mirror the legacy "already executed" 400 to keep the contract identical.
    if (flags.stateMachineEnabled && idempotencyKey) {
      const prior = await this.orderLedger.findByIdempotency(userId, idempotencyKey);
      const terminal = prior.filter((r) =>
        r.status === 'EXECUTED' || r.status === 'FAILED' || r.status === 'PARTIALLY_FAILED',
      );
      if (terminal.length > 0) {
        throw new BadRequestException(
          `Idempotency key already used (ledger contains ${terminal.length} terminal row(s))`,
        );
      }
    }

    // 1. Read pending commit.
    // - Legacy path: GETDEL is the atomic single-Redis-op consume.
    // - M2 path (state machine): GET only — pending stays in Redis as the
    //   safety net until the durable ledger row exists. We DEL after the
    //   EXECUTING insert succeeds, so a crash between the GET and the
    //   INSERT leaves both untouched and the next attempt is safe; a crash
    //   between the INSERT and the DEL leaves rows AND pending, and the
    //   per-(user, commit_hash) duplicate-detection step below surfaces a
    //   409 instead of letting the broker run twice.
    let raw: string | null;
    if (flags.stateMachineEnabled) {
      raw = await this.redis.get(pendingKey);
    } else {
      raw = await (
        this.redis as Redis & { getdel(key: string): Promise<string | null> }
      ).getdel(pendingKey);
    }

    if (!raw) {
      throw new BadRequestException('No pending commit found. Stage and commit operations first.');
    }

    const commitData = JSON.parse(raw) as CommitData;

    // 2. Get or create wallet
    const wallet = await this.getOrCreateWallet(userId);

    // 3. Idempotency: check if this hash was already executed.
    // Legacy path: wallet.commitHistory.
    // M2 path: ledger lookup by commit_hash. If any EXECUTING/EXECUTED/
    // PARTIALLY_FAILED/FAILED rows exist for this (user, commit_hash),
    // we are in the durable-record-survived-crash window — surface 409
    // and let the operator/reconciler decide. Re-running brokers when
    // EXECUTING rows already exist would double-spend.
    if (flags.stateMachineEnabled) {
      const priorByHash = await this.orderLedger.findByCommitHash(commitData.hash);
      const inflight = priorByHash.filter(
        (r) =>
          r.userId === userId &&
          (r.status === 'EXECUTING' ||
            r.status === 'EXECUTED' ||
            r.status === 'PARTIALLY_FAILED' ||
            r.status === 'FAILED'),
      );
      if (inflight.length > 0) {
        throw new BadRequestException(
          `Commit ${commitData.hash.substring(0, 8)}... already has ${inflight.length} ledger row(s) (status=${inflight[0]!.status}); refusing to re-execute`,
        );
      }
    } else {
      const existingHashes = (wallet.commitHistory as CommitData[]).map((c) => c.hash);
      if (existingHashes.includes(commitData.hash)) {
        throw new BadRequestException(
          `Commit ${commitData.hash.substring(0, 8)}... already executed (idempotency check)`,
        );
      }
    }

    // 3b. M2 only — durable-first state machine transition.
    // Order:
    //   (a) INSERT EXECUTING rows (durable record exists)
    //   (b) DEL pending (now safe — rows are the system of record)
    //   (c) broker calls
    //   (d) transitionFromExecuting → EXECUTED/FAILED
    // Crash between (a) and (b): pending + EXECUTING rows present; retry
    //   is caught by the per-(user, commit_hash) check above and 409s.
    // Crash between (b) and (d): pending gone, EXECUTING rows present;
    //   the M3 reconciler picks them up by stale updated_at and queries
    //   the broker for ground truth.
    let executingRowIds: string[] = [];
    if (flags.stateMachineEnabled) {
      executingRowIds = await this.orderLedger.recordExecuting({
        userId,
        commitHash: commitData.hash,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        broker: (wallet.tradingMode as TradingMode) === TradingMode.PAPER ? 'paper' : 'live',
        operations: commitData.operations as {
          symbol: unknown;
          action: unknown;
          qty?: unknown;
          amount?: unknown;
        }[],
      });
      // Durable record now exists. Safe to clear pending.
      await this.redis.del(pendingKey);
    }

    // 4. Execute operations
    const mode = wallet.tradingMode as TradingMode;
    const operationResults: Record<string, unknown>[] = [];
    const reportLines: string[] = [];

    if (mode === TradingMode.PAPER) {
      // Create a shared PaperBroker, sync wallet state to engine, execute all ops
      const contract = Contract.stock('PLACEHOLDER');
      const broker = this.brokerRegistry.resolve(
        contract,
        TradingMode.PAPER,
        Number(wallet.cashBalance),
      ) as PaperBroker;

      const engine = broker.engine();

      // Sync wallet state to engine. When the decimal-execute flag is on,
      // load via string-based methods so prior wallet writes preserved at
      // .toFixed(8) round-trip without going through `Number(...)`.
      if (this.tradingFlags().decimalExecuteEnabled) {
        engine.setCashFromString(String(wallet.cashBalance));
        const positionsAsStrings = (wallet.positions as unknown[]).map((p) => {
          const pos = p as PositionMap | PositionMapString;
          return {
            ticker: pos.ticker,
            shares: String(pos.shares),
            avgCost: String(pos.avgCost),
            currentPrice: String(pos.currentPrice),
          };
        });
        engine.setPositionsFromStrings(positionsAsStrings);
      } else {
        engine.setCash(Number(wallet.cashBalance));
        engine.setPositions(
          (wallet.positions as PositionMap[]).map((p) => ({
            ticker: p.ticker,
            shares: p.shares,
            avgCost: p.avgCost,
            currentPrice: p.currentPrice,
          })),
        );
      }

      // Execute each operation
      for (const op of commitData.operations) {
        try {
          const opContract = Contract.fromString(String(op.symbol));
          const orderResult = await broker.placeOrder(opContract, {
            symbol: String(op.symbol),
            side:
              String(op.action).toLowerCase() === 'sell' ||
              String(op.action).toLowerCase() === 'close'
                ? 'sell'
                : 'buy',
            type: 'market',
            qty: op.qty ? String(op.qty) : undefined,
            notional: op.amount ? String(op.amount) : undefined,
          });

          operationResults.push({
            symbol: op.symbol,
            action: op.action,
            success: orderResult.success,
            filledQty: orderResult.filledQty,
            avgPrice: orderResult.avgPrice,
            errorMessage: orderResult.errorMessage,
          });

          const statusIcon = orderResult.success ? 'OK' : 'FAIL';
          reportLines.push(
            `[${statusIcon}] ${op.action} ${op.symbol}: qty=${orderResult.filledQty} @ $${orderResult.avgPrice}`,
          );
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          operationResults.push({
            symbol: op.symbol,
            action: op.action,
            success: false,
            errorMessage: errorMsg,
          });
          reportLines.push(`[FAIL] ${op.action} ${op.symbol}: ${errorMsg}`);
        }
      }

      // Sync engine state back to wallet.
      // When TRADING_DECIMAL_EXECUTE_ENABLED=true (item 4 M3), use the
      // string-based boundary so wallet persistence keeps Decimal precision.
      // Default behavior — number round-trip — is identical to today.
      if (this.tradingFlags().decimalExecuteEnabled) {
        wallet.cashBalance = engine.getCashAsString();
        wallet.positions = engine.getPositionMapsAsStrings() as unknown[];
      } else {
        wallet.cashBalance = String(engine.getCash());
        wallet.positions = engine.getPositionMaps() as unknown[];
      }
    } else {
      // LIVE mode: pre-flight guards (item 5) — kill switch + per-order
      // notional cap + per-day per-user cumulative cap. Throws on breach;
      // throw propagates BEFORE any broker call so a guard breach never
      // triggers a partial fill. EXECUTING rows already inserted by M2 are
      // transitioned to FAILED with the breach reason in the catch below.
      try {
        await this.tradingGuards.preflight({
          userId,
          operations: commitData.operations as Parameters<
            typeof this.tradingGuards.preflight
          >[0]['operations'],
        });
      } catch (guardErr) {
        const reason = guardErr instanceof Error ? guardErr.message : String(guardErr);
        // Bubble FAILED to EXECUTING rows so the ledger reflects the block.
        if (flags.stateMachineEnabled && executingRowIds.length > 0) {
          await this.orderLedger.transitionAll(executingRowIds, 'FAILED', reason);
        }
        throw guardErr;
      }

      // LIVE mode: resolve broker per-contract via BrokerRegistry
      for (const op of commitData.operations) {
        try {
          const opContract = Contract.fromString(String(op.symbol));
          const broker = this.brokerRegistry.resolve(opContract, TradingMode.LIVE, 0);

          const orderResult = await broker.placeOrder(opContract, {
            symbol: String(op.symbol),
            side:
              String(op.action).toLowerCase() === 'sell' ||
              String(op.action).toLowerCase() === 'close'
                ? 'sell'
                : 'buy',
            type: 'market',
            qty: op.qty ? String(op.qty) : undefined,
            notional: op.amount ? String(op.amount) : undefined,
          });

          operationResults.push({
            symbol: op.symbol,
            action: op.action,
            success: orderResult.success,
            filledQty: orderResult.filledQty,
            avgPrice: orderResult.avgPrice,
            errorMessage: orderResult.errorMessage,
          });

          const statusIcon = orderResult.success ? 'OK' : 'FAIL';
          reportLines.push(
            `[${statusIcon}] ${op.action} ${op.symbol}: qty=${orderResult.filledQty} @ $${orderResult.avgPrice}`,
          );
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          operationResults.push({
            symbol: op.symbol,
            action: op.action,
            success: false,
            errorMessage: errorMsg,
          });
          reportLines.push(`[FAIL] ${op.action} ${op.symbol}: ${errorMsg}`);
        }
      }
    }

    // 5. Persist wallet (cash + positions always — read paths still need
    // them). When state-machine flag is OFF, also append commitHistory
    // (legacy system of record). When ON, ledger rows are the system of
    // record and commitHistory is left untouched.
    const now = new Date();
    if (flags.stateMachineEnabled) {
      await this.db
        .update(tradeWallets)
        .set({
          cashBalance: wallet.cashBalance,
          positions: wallet.positions,
          updatedAt: now,
        })
        .where(eq(tradeWallets.id, wallet.id));
    } else {
      const history = [...(wallet.commitHistory as CommitData[])];
      history.push({ ...commitData });
      while (history.length > MAX_COMMIT_HISTORY) {
        history.shift();
      }
      await this.db
        .update(tradeWallets)
        .set({
          cashBalance: wallet.cashBalance,
          positions: wallet.positions,
          commitHistory: history,
          updatedAt: now,
        })
        .where(eq(tradeWallets.id, wallet.id));
    }

    // 6. Ledger update.
    // - Flag OFF (M1 dual-write): insert terminal-status rows now that the
    //   wallet write committed. Failures are non-fatal.
    // - Flag ON (M2 state machine): rows already inserted as EXECUTING up
    //   front; transition them to EXECUTED/FAILED in matching order.
    if (flags.stateMachineEnabled) {
      try {
        await this.orderLedger.transitionFromExecuting(
          executingRowIds,
          operationResults as unknown as Parameters<
            typeof this.orderLedger.transitionFromExecuting
          >[1],
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // M2 invariant violation — surface loudly. Reconciler (M3) will
        // pick the EXECUTING rows up by their stale updated_at.
        this.logger.error(
          `order_ledger M2 transition failed user=${userId} commit=${commitData.hash.substring(0, 8)}... err=${msg}; rows remain EXECUTING for reconciler`,
        );
      }
    } else {
      try {
        await this.orderLedger.recordExecutionResults({
          userId,
          commitHash: commitData.hash,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          broker: mode === TradingMode.PAPER ? 'paper' : 'live',
          operations: operationResults as unknown as Parameters<
            typeof this.orderLedger.recordExecutionResults
          >[0]['operations'],
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `order_ledger dual-write failed user=${userId} commit=${commitData.hash.substring(0, 8)}... err=${msg} (trading flow continues; wallet remains source of truth)`,
        );
      }
    }

    // 7. Build report
    const report = [
      `Executed commit ${commitData.hash.substring(0, 8)}... (${commitData.operations.length} ops)`,
      `Message: ${commitData.message}`,
      '',
      ...reportLines,
    ].join('\n');

    const result: ExecuteResult = {
      report,
      commitData: commitData as unknown as Record<string, unknown>,
      results: operationResults,
    };

    // 7. Cache the ExecuteResult by idempotencyKey for retry-safe re-execute.
    if (execCacheKey) {
      await this.redis.setex(execCacheKey, STATE_TTL_SECONDS, JSON.stringify(result));
    }

    // 8. Emit event (stub — actual AgentEventService built in Phase 10)
    this.emitTradeEvent(userId, wallet.id, AgentEventType.TRADE_COMMIT_EXECUTED, {
      hash: commitData.hash,
      message: commitData.message,
      operationCount: commitData.operations.length,
      results: operationResults,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Wallet management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get or create a $100k paper trading wallet for the given user.
   */
  async getOrCreateWallet(userId: string): Promise<WalletRow> {
    const rows = await this.db
      .select()
      .from(tradeWallets)
      .where(eq(tradeWallets.userId, userId))
      .limit(1);

    if (rows.length > 0) {
      return rows[0] as WalletRow;
    }

    // Create new wallet with $100k
    const inserted = await this.db
      .insert(tradeWallets)
      .values({
        userId,
        initialCapital: DEFAULT_INITIAL_CAPITAL,
        cashBalance: DEFAULT_INITIAL_CAPITAL,
        tradingMode: TradingMode.PAPER,
        positions: [],
        commitHistory: [],
      })
      .returning();

    return inserted[0] as WalletRow;
  }

  /**
   * Switch the user's trading mode (PAPER / LIVE).
   */
  async switchMode(userId: string, mode: TradingMode): Promise<void> {
    const wallet = await this.getOrCreateWallet(userId);

    await this.db
      .update(tradeWallets)
      .set({
        tradingMode: mode,
        updatedAt: new Date(),
      })
      .where(eq(tradeWallets.id, wallet.id));

    this.logger.log(`Switched trading mode to ${mode} for user ${userId}`);
  }

  /**
   * Human-readable wallet status text for agent tool responses.
   */
  async getWalletStatus(userId: string): Promise<string> {
    const wallet = await this.getOrCreateWallet(userId);
    const positions = wallet.positions as PositionMap[];
    const initialCapital = Number(wallet.initialCapital);
    const cashBalance = Number(wallet.cashBalance);

    // Calculate total position value
    let positionValue = 0;
    for (const pos of positions) {
      positionValue += pos.shares * (pos.currentPrice || pos.avgCost);
    }

    const totalValue = cashBalance + positionValue;
    const returnPct = ((totalValue - initialCapital) / initialCapital) * 100;

    const lines: string[] = [
      `Trading Mode: ${wallet.tradingMode}`,
      `Cash: $${cashBalance.toFixed(2)}`,
      `Position Value: $${positionValue.toFixed(2)}`,
      `Total Value: $${totalValue.toFixed(2)}`,
      `Return: ${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%`,
    ];

    if (positions.length > 0) {
      lines.push('', 'Positions:');
      for (const pos of positions) {
        lines.push(
          `  ${pos.ticker}: ${pos.shares} shares @ $${pos.avgCost.toFixed(2)} (current: $${(pos.currentPrice || pos.avgCost).toFixed(2)})`,
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * Structured wallet response (V2WalletResponse).
   */
  async getWalletStatusStructured(userId: string): Promise<V2WalletResponse> {
    const wallet = await this.getOrCreateWallet(userId);
    const positions = wallet.positions as PositionMap[];
    const initialCapital = Number(wallet.initialCapital);
    const cashBalance = Number(wallet.cashBalance);

    let positionValue = 0;
    const positionResponses = positions.map((pos) => {
      const currentPrice = pos.currentPrice || pos.avgCost;
      const marketValue = pos.shares * currentPrice;
      const unrealizedPnl = (currentPrice - pos.avgCost) * pos.shares;
      const pnlPercent = pos.avgCost > 0 ? ((currentPrice - pos.avgCost) / pos.avgCost) * 100 : 0;
      positionValue += marketValue;

      return {
        symbol: pos.ticker,
        qty: String(pos.shares),
        avgCost: pos.avgCost.toFixed(2),
        currentPrice: currentPrice.toFixed(2),
        marketValue: marketValue.toFixed(2),
        unrealizedPnl: unrealizedPnl.toFixed(2),
        pnlPercent: pnlPercent.toFixed(2),
        securityType: SecurityType.STOCK,
      };
    });

    const totalValue = cashBalance + positionValue;
    const returnPct = ((totalValue - initialCapital) / initialCapital) * 100;

    return {
      cashBalance: cashBalance.toFixed(2),
      initialCapital: initialCapital.toFixed(2),
      totalValue: totalValue.toFixed(2),
      returnPercent: returnPct.toFixed(2),
      tradingMode: wallet.tradingMode,
      positions: positionResponses,
    };
  }

  /**
   * Human-readable commit log text.
   */
  async getCommitLog(userId: string, limit: number = 10): Promise<string> {
    const wallet = await this.getOrCreateWallet(userId);
    const history = (wallet.commitHistory as CommitData[]).slice(-limit);

    if (history.length === 0) {
      return 'No commit history yet.';
    }

    return history
      .reverse()
      .map(
        (c, i) =>
          `${i + 1}. [${c.hash.substring(0, 8)}] ${c.message} (${c.operations.length} ops, ${c.timestamp})`,
      )
      .join('\n');
  }

  async getPositions(userId: string): Promise<string> {
    const wallet = await this.getOrCreateWallet(userId);
    const positions = wallet.positions as PositionMap[];

    if (positions.length === 0) {
      return 'No open positions.';
    }

    return positions
      .map(
        (position) =>
          `${position.ticker}: ${position.shares} shares @ $${position.avgCost.toFixed(2)} (current: $${(position.currentPrice || position.avgCost).toFixed(2)})`,
      )
      .join('\n');
  }

  async getStagedOrders(userId: string): Promise<string> {
    const staged = await this.getStagingArea(userId);
    if (staged.length === 0) {
      return 'No staged orders.';
    }
    return JSON.stringify(staged, null, 2);
  }

  /**
   * Structured commit log (V2CommitResponse[]).
   */
  async getCommitLogStructured(userId: string, limit: number = 10): Promise<V2CommitResponse[]> {
    const wallet = await this.getOrCreateWallet(userId);
    const history = (wallet.commitHistory as CommitData[]).slice(-limit);

    return history.reverse().map((c, idx) => ({
      hash: c.hash,
      parentHash: idx < history.length - 1 ? history[idx + 1]!.hash : '',
      message: c.message,
      timestamp: c.timestamp,
      operations: c.operations.map((op) => ({
        action: String(op.action ?? ''),
        symbol: String(op.symbol ?? ''),
        qty: String(op.qty ?? ''),
        amount: String(op.amount ?? ''),
        price: String(op.price ?? ''),
      })),
      results: [],
    }));
  }

  /**
   * Search assets — delegates to MarketDataService.
   */
  async searchAssets(_userId: string, query: string): Promise<unknown[]> {
    return this.marketDataService.searchTickers(query);
  }

  async checkMarketHours(userId: string): Promise<string> {
    const wallet = await this.getOrCreateWallet(userId);
    const broker = this.brokerRegistry.resolve(
      this.resolveOperationalContract(wallet),
      wallet.tradingMode as TradingMode,
      Number(wallet.cashBalance),
    );
    const clock = await broker.getMarketClock();

    return [
      `Market open: ${clock.isOpen ? 'YES' : 'NO'}`,
      `Timestamp: ${clock.timestamp}`,
      `Next open: ${clock.nextOpen ?? 'N/A'}`,
      `Next close: ${clock.nextClose ?? 'N/A'}`,
    ].join('\n');
  }

  async syncOrders(userId: string): Promise<string> {
    const wallet = await this.getOrCreateWallet(userId);
    const broker = this.brokerRegistry.resolve(
      this.resolveOperationalContract(wallet),
      wallet.tradingMode as TradingMode,
      Number(wallet.cashBalance),
    );
    const results = await broker.syncOrders();

    if (results.length === 0) {
      return 'No broker order updates.';
    }

    return JSON.stringify(results, null, 2);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Stub event emitter — logs but doesn't persist.
   * Actual AgentEventService built in Phase 10.
   */
  private emitTradeEvent(
    userId: string,
    walletId: string,
    eventType: AgentEventTypeValue,
    payload: Record<string, unknown>,
  ): void {
    this.logger.log(
      `[Event] ${eventType} for user ${userId} wallet ${walletId}: ${JSON.stringify(payload)}`,
    );
  }

  private resolveOperationalContract(wallet: WalletRow): Contract {
    const history = wallet.commitHistory as CommitData[];
    for (let commitIndex = history.length - 1; commitIndex >= 0; commitIndex--) {
      const operations = history[commitIndex]?.operations ?? [];
      for (let operationIndex = operations.length - 1; operationIndex >= 0; operationIndex--) {
        const symbol = operations[operationIndex]?.['symbol'];
        if (typeof symbol === 'string' && symbol.trim().length > 0) {
          return Contract.fromString(symbol);
        }
      }
    }

    const positions = wallet.positions as PositionMap[];
    const firstTicker = positions.find((position) => position.ticker.trim().length > 0)?.ticker;
    if (firstTicker) {
      return Contract.fromString(firstTicker);
    }

    return Contract.stock('AAPL');
  }
}
