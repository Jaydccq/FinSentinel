import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type Redis from 'ioredis';
import { tradeWallets, eq } from '@finsentinel/db';
import { TradingMode, Contract, AgentEventType, SecurityType } from '@finsentinel/shared';
import type { AgentEventType as AgentEventTypeValue } from '@finsentinel/shared';
import type { UnifiedStageRequest, V2WalletResponse, V2CommitResponse, V2StagedResponse } from '@finsentinel/shared';
import { BrokerRegistry } from './broker-registry.service';
import { PaperBroker } from './brokers/paper.broker';
import type { MarketDataService } from '../market/market-data.service';
import type { ExecuteResult } from './interfaces/execute-result';
import type { PositionMap } from './engines/paper-trading.engine';

// ── Constants ───────────────────────────────────────────────────────────────

const STAGING_KEY_PREFIX = 'uta:staging:';
const PENDING_KEY_PREFIX = 'uta:pending:';
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
}

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * UnifiedTradingService — core trading orchestration with stage/commit/execute lifecycle.
 *
 * Mirrors the Java UnifiedTradingService with:
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
    @Inject('MarketDataService') private readonly marketDataService: MarketDataService,
  ) {}

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
    const result = await (this.redis as any)['eval'](
      LUA_ATOMIC_APPEND,
      1,      // number of KEYS
      key,    // KEYS[1]
      String(MAX_STAGING_SIZE),  // ARGV[1]
      item,                      // ARGV[2]
      String(STATE_TTL_SECONDS), // ARGV[3]
    ) as number;

    if (result === -1) {
      throw new BadRequestException(
        `Staging area is full (max ${MAX_STAGING_SIZE} operations). Commit or clear before adding more.`,
      );
    }

    this.logger.log(`Staged operation for user ${userId}: ${op.action} ${op.symbol} (count: ${result})`);
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
   * Commit all staged operations. Generates a SHA-256 hash, moves ops to
   * a pending key, and clears the staging area.
   *
   * @returns Object with hash and operation count.
   */
  async commit(
    userId: string,
    message: string,
  ): Promise<{ hash: string; count: number }> {
    // Validate message
    if (!message || message.trim().length === 0) {
      throw new BadRequestException('Commit message must not be blank');
    }

    // Read staging area
    const ops = await this.getStagingArea(userId);
    if (ops.length === 0) {
      throw new BadRequestException('Nothing staged — stage operations before committing');
    }

    // Generate SHA-256 hash: message + "|" + ops.toString() + "|" + timestamp
    const timestamp = new Date().toISOString();
    const hashInput = `${message}|${JSON.stringify(ops)}|${timestamp}`;
    const hash = sha256(hashInput);

    // Build commit data
    const commitData: CommitData = {
      hash,
      message,
      timestamp,
      operations: ops,
    };

    // Store as pending commit in Redis (single atomic setex)
    const pendingKey = PENDING_KEY_PREFIX + userId;
    await this.redis.setex(pendingKey, STATE_TTL_SECONDS, JSON.stringify(commitData));

    // Clear staging
    await this.clearStagingArea(userId);

    this.logger.log(
      `Committed ${ops.length} operation(s) for user ${userId}, hash=${hash.substring(0, 8)}...`,
    );

    return { hash, count: ops.length };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 3: Execute
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute the pending commit.
   *
   * 1. Atomic get-and-delete from Redis (prevents double-spend)
   * 2. Idempotency check: reject if hash already in wallet.commitHistory
   * 3. For PAPER mode: create shared PaperBroker, sync state, execute, sync back
   * 4. Build execution report
   * 5. Add commit to wallet.commitHistory (capped at MAX_COMMIT_HISTORY)
   * 6. Persist wallet to DB
   * 7. Emit event (stub)
   */
  async execute(userId: string): Promise<ExecuteResult> {
    // 1. Atomic get-and-delete pending commit (Redis 6.2+ GETDEL)
    const pendingKey = PENDING_KEY_PREFIX + userId;
    const raw = await (this.redis as any).getdel(pendingKey) as string | null;

    if (!raw) {
      throw new BadRequestException(
        'No pending commit found. Stage and commit operations first.',
      );
    }

    const commitData = JSON.parse(raw) as CommitData;

    // 2. Get or create wallet
    const wallet = await this.getOrCreateWallet(userId);

    // 3. Idempotency: check if this hash was already executed
    const existingHashes = (wallet.commitHistory as CommitData[]).map(
      (c) => c.hash,
    );
    if (existingHashes.includes(commitData.hash)) {
      throw new BadRequestException(
        `Commit ${commitData.hash.substring(0, 8)}... already executed (idempotency check)`,
      );
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

      // Sync wallet state to engine
      engine.setCash(Number(wallet.cashBalance));
      engine.setPositions(
        (wallet.positions as PositionMap[]).map((p) => ({
          ticker: p.ticker,
          shares: p.shares,
          avgCost: p.avgCost,
          currentPrice: p.currentPrice,
        })),
      );

      // Execute each operation
      for (const op of commitData.operations) {
        try {
          const opContract = Contract.fromString(String(op.symbol));
          const orderResult = await broker.placeOrder(opContract, {
            symbol: String(op.symbol),
            side: String(op.action).toLowerCase() === 'sell' || String(op.action).toLowerCase() === 'close'
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

      // Sync engine state back to wallet
      wallet.cashBalance = String(engine.getCash());
      wallet.positions = engine.getPositionMaps() as unknown[];
    } else {
      // LIVE mode: resolve broker per-contract via BrokerRegistry
      for (const op of commitData.operations) {
        try {
          const opContract = Contract.fromString(String(op.symbol));
          const broker = this.brokerRegistry.resolve(
            opContract,
            TradingMode.LIVE,
            0,
          );

          const orderResult = await broker.placeOrder(opContract, {
            symbol: String(op.symbol),
            side: String(op.action).toLowerCase() === 'sell' || String(op.action).toLowerCase() === 'close'
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

    // 5. Add commit to wallet.commitHistory (capped at MAX_COMMIT_HISTORY)
    const history = [...(wallet.commitHistory as CommitData[])];
    history.push({
      ...commitData,
    });
    // Cap at MAX_COMMIT_HISTORY — remove oldest entries
    while (history.length > MAX_COMMIT_HISTORY) {
      history.shift();
    }

    // 6. Persist wallet to DB
    const now = new Date();
    await this.db
      .update(tradeWallets)
      .set({
        cashBalance: wallet.cashBalance,
        positions: wallet.positions,
        commitHistory: history,
        updatedAt: now,
      })
      .where(eq(tradeWallets.id, wallet.id));

    // 7. Build report
    const report = [
      `Executed commit ${commitData.hash.substring(0, 8)}... (${commitData.operations.length} ops)`,
      `Message: ${commitData.message}`,
      '',
      ...reportLines,
    ].join('\n');

    // 8. Emit event (stub — actual AgentEventService built in Phase 10)
    this.emitTradeEvent(userId, wallet.id, AgentEventType.TRADE_COMMIT_EXECUTED, {
      hash: commitData.hash,
      message: commitData.message,
      operationCount: commitData.operations.length,
      results: operationResults,
    });

    return {
      report,
      commitData: commitData as unknown as Record<string, unknown>,
      results: operationResults,
    };
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
      const pnlPercent =
        pos.avgCost > 0
          ? ((currentPrice - pos.avgCost) / pos.avgCost) * 100
          : 0;
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

  /**
   * Structured commit log (V2CommitResponse[]).
   */
  async getCommitLogStructured(
    userId: string,
    limit: number = 10,
  ): Promise<V2CommitResponse[]> {
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
  async searchAssets(
    _userId: string,
    query: string,
  ): Promise<unknown[]> {
    return this.marketDataService.searchTickers(query);
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
}
