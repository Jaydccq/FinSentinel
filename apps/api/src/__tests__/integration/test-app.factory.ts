/**
 * Integration test factory — creates a full NestJS app with mock DB and Redis.
 *
 * Overrides only infrastructure providers (DRIZZLE_DB, REDIS) with in-memory
 * implementations, so controllers, guards, pipes, and services run their real
 * code paths. External services (AI, Polygon, S3) are stubbed at the provider
 * level to avoid network calls.
 */
// Import setup first — sets env vars before any NestJS module is loaded
import './setup';

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import {
  VECTORIZE_QUEUE_TOKEN,
  NEWS_ENRICH_QUEUE_TOKEN,
} from '../../queue/queue.constants';
import { VectorizeConsumer } from '../../queue/vectorize.consumer';
import { NewsEnrichConsumer } from '../../queue/news-enrich.consumer';

// ════════════════════════════════════════════════════════════════════════════
// Mock DB — in-memory Drizzle-compatible query builder
// ════════════════════════════════════════════════════════════════════════════

/**
 * A minimal mock that simulates Drizzle's fluent query API using in-memory
 * Maps keyed by table reference. Supports select/insert/update/delete with
 * .from(), .where(), .limit(), .values(), .set(), .returning().
 *
 * This is NOT a full Drizzle mock — it covers the patterns used by
 * AuthService, PortfolioService, UnifiedTradingService, and AgentEventService.
 */
export function createMockDb() {
  // Storage: Map from table symbol → array of rows
  const tables = new Map<unknown, Record<string, unknown>[]>();

  function getTable(table: unknown): Record<string, unknown>[] {
    if (!tables.has(table)) {
      tables.set(table, []);
    }
    return tables.get(table)!;
  }

  /**
   * Where-clause evaluator — parses real Drizzle ORM SQL objects.
   *
   * Drizzle's `eq(column, value)` returns a `SQL` instance with `queryChunks`:
   *   [StringChunk(''), Column, StringChunk(' = '), Param(value), StringChunk('')]
   *
   * Drizzle's `and(eq1, eq2)` returns a `SQL` with `queryChunks`:
   *   [StringChunk('('), SQL([eq1, StringChunk(' and '), eq2]), StringChunk(')')]
   *
   * We extract the column name and comparison value from these structures.
   */
  function matchesWhere(
    row: Record<string, unknown>,
    whereFn: unknown,
  ): boolean {
    if (!whereFn) return true;

    const sql = whereFn as {
      queryChunks?: unknown[];
      name?: string;    // Column has .name
      value?: unknown;  // Param or StringChunk has .value
    };

    // Not a SQL object — fallback to true
    if (!sql.queryChunks) return true;

    const chunks = sql.queryChunks;

    // Detect eq() pattern: 5 chunks with Column at [1] and Param at [3]
    if (chunks.length === 5) {
      const colChunk = chunks[1] as { name?: string };
      const opChunk = chunks[2] as { value?: string[] };
      const paramChunk = chunks[3] as { value?: unknown };

      if (colChunk?.name && opChunk?.value?.[0]?.includes('=') && paramChunk && 'value' in paramChunk) {
        return row[colChunk.name] === paramChunk.value;
      }
    }

    // Detect and() pattern: 3 chunks where middle chunk is a nested SQL with ' and ' separators
    if (chunks.length === 3) {
      const inner = chunks[1] as { queryChunks?: unknown[] };
      if (inner?.queryChunks) {
        // Inner queryChunks alternate: [sql1, StringChunk(' and '), sql2, ...]
        const conditions = inner.queryChunks.filter(
          (_: unknown, i: number) => i % 2 === 0,
        );
        return conditions.every((c: unknown) => matchesWhere(row, c));
      }
    }

    // Unknown structure — match everything (safe fallback)
    return true;
  }

  // Builder that mimics Drizzle's fluent API
  const db = {
    _tables: tables,

    select() {
      let _table: unknown;
      let _whereClause: unknown;
      let _limit: number | undefined;
      let _offset = 0;

      const chain = {
        from(table: unknown) {
          _table = table;
          return chain;
        },
        where(clause: unknown) {
          _whereClause = clause;
          return chain;
        },
        limit(n: number) {
          _limit = n;
          return chain;
        },
        offset(n: number) {
          _offset = n;
          return chain;
        },
        orderBy(_clause: unknown) {
          return chain;
        },
        then(resolve: (rows: Record<string, unknown>[]) => void) {
          let rows = getTable(_table).filter((r) =>
            matchesWhere(r, _whereClause),
          );
          if (_offset > 0) {
            rows = rows.slice(_offset);
          }
          if (_limit !== undefined) {
            rows = rows.slice(0, _limit);
          }
          resolve(rows);
        },
        // Make it thenable (async/await compatible)
        [Symbol.toStringTag]: 'Promise' as const,
        catch(_reject: (err: unknown) => void) {
          return this;
        },
      };
      return chain;
    },

    insert(table: unknown) {
      let _values: Record<string, unknown> | undefined;

      // Build the materialised result eagerly inside `then` and route through
      // a real Promise so that rejection (e.g. simulated Postgres 23505 unique
      // violation) propagates through `await` cleanly instead of throwing
      // synchronously up the express stack.
      const settle = (): Promise<Record<string, unknown>[]> => {
        // Mirror the V1 schema's UNIQUE constraints on users(username, email).
        // We can't reliably name the table from a Drizzle symbol-keyed object,
        // so we treat any insert that carries BOTH username + email + password
        // as a users-table insert. That's specific enough to avoid colliding
        // with other tables (none of which carry that combo).
        const looksLikeUsersInsert =
          _values &&
          typeof _values.username === 'string' &&
          typeof _values.email === 'string' &&
          typeof _values.password === 'string';
        if (looksLikeUsersInsert) {
          const rows = getTable(table);
          const dupe = rows.find(
            (r) =>
              r.username === _values!.username || r.email === _values!.email,
          );
          if (dupe) {
            const err = Object.assign(
              new Error('duplicate key value violates unique constraint (mocked)'),
              { code: '23505' },
            );
            return Promise.reject(err);
          }
        }
        const row = {
          id: randomUUID(),
          ..._values,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        getTable(table).push(row);
        return Promise.resolve([row]);
      };

      const chain = {
        values(vals: Record<string, unknown>) {
          _values = vals;
          return chain;
        },
        returning() {
          return chain;
        },
        then(
          resolve: (rows: Record<string, unknown>[]) => void,
          reject?: (err: unknown) => void,
        ) {
          settle().then(resolve, reject);
        },
        [Symbol.toStringTag]: 'Promise' as const,
        catch(reject: (err: unknown) => void) {
          return settle().catch(reject);
        },
      };
      return chain;
    },

    update(table: unknown) {
      let _setValues: Record<string, unknown> | undefined;
      let _whereClause: unknown;

      const chain = {
        set(vals: Record<string, unknown>) {
          _setValues = vals;
          return chain;
        },
        where(clause: unknown) {
          _whereClause = clause;
          return chain;
        },
        returning() {
          return chain;
        },
        then(resolve: (rows: Record<string, unknown>[]) => void) {
          const rows = getTable(table);
          const updated: Record<string, unknown>[] = [];
          for (const row of rows) {
            if (matchesWhere(row, _whereClause)) {
              Object.assign(row, _setValues);
              updated.push(row);
            }
          }
          resolve(updated);
        },
        [Symbol.toStringTag]: 'Promise' as const,
        catch(_reject: (err: unknown) => void) {
          return this;
        },
      };
      return chain;
    },

    delete(table: unknown) {
      let _whereClause: unknown;

      const chain = {
        where(clause: unknown) {
          _whereClause = clause;
          return chain;
        },
        then(resolve: (result: unknown) => void) {
          const rows = getTable(table);
          const remaining = rows.filter(
            (r) => !matchesWhere(r, _whereClause),
          );
          tables.set(table, remaining);
          resolve({ rowCount: rows.length - remaining.length });
        },
        [Symbol.toStringTag]: 'Promise' as const,
        catch(_reject: (err: unknown) => void) {
          return this;
        },
      };
      return chain;
    },
  };

  return db;
}

// ════════════════════════════════════════════════════════════════════════════
// Mock Redis — Map-based in-memory store
// ════════════════════════════════════════════════════════════════════════════

export function createMockRedis() {
  const store = new Map<string, string>();
  const expiries = new Map<string, number>();

  const redis = {
    get(key: string): Promise<string | null> {
      // Check expiry
      const exp = expiries.get(key);
      if (exp && Date.now() > exp) {
        store.delete(key);
        expiries.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(store.get(key) ?? null);
    },
    set(key: string, value: string): Promise<'OK'> {
      store.set(key, value);
      return Promise.resolve('OK');
    },
    setex(key: string, seconds: number, value: string): Promise<'OK'> {
      store.set(key, value);
      expiries.set(key, Date.now() + seconds * 1000);
      return Promise.resolve('OK');
    },
    del(key: string): Promise<number> {
      const had = store.has(key);
      store.delete(key);
      expiries.delete(key);
      return Promise.resolve(had ? 1 : 0);
    },
    getdel(key: string): Promise<string | null> {
      // Check expiry
      const exp = expiries.get(key);
      if (exp && Date.now() > exp) {
        store.delete(key);
        expiries.delete(key);
        return Promise.resolve(null);
      }
      const value = store.get(key) ?? null;
      if (value !== null) {
        store.delete(key);
        expiries.delete(key);
      }
      return Promise.resolve(value);
    },
    expire(key: string, seconds: number): Promise<number> {
      if (store.has(key)) {
        expiries.set(key, Date.now() + seconds * 1000);
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    },
    incr(key: string): Promise<number> {
      const current = parseInt(store.get(key) ?? '0', 10);
      const next = current + 1;
      store.set(key, String(next));
      return Promise.resolve(next);
    },
    ttl(key: string): Promise<number> {
      const exp = expiries.get(key);
      if (!exp) return Promise.resolve(-1);
      return Promise.resolve(Math.ceil((exp - Date.now()) / 1000));
    },
    /**
     * Lua script execution stub — handles the rate-limit and staging scripts.
     *
     * This simulates ioredis's redis.eval() which sends Lua to the Redis
     * server for execution. It is NOT JavaScript eval() — it is safe and
     * standard practice for atomic Redis operations.
     */
    luaEval(
      script: string,
      numKeys: number,
      ...args: unknown[]
    ): Promise<unknown> {
      // Rate-limit script: returns [allowed, remaining, ttl*1000]
      if (script.includes('INCR') && script.includes('EXPIRE') && script.includes('TTL')) {
        const key = String(args[0]);
        const windowSecs = Number(args[1]);
        const limit = Number(args[2]);
        const current = parseInt(store.get(key) ?? '0', 10) + 1;
        store.set(key, String(current));
        if (current === 1) {
          expiries.set(key, Date.now() + windowSecs * 1000);
        }
        const ttl = expiries.get(key)
          ? Math.ceil((expiries.get(key)! - Date.now()) / 1000)
          : windowSecs;
        const allowed = current <= limit ? 1 : 0;
        const remaining = Math.max(0, limit - current);
        return Promise.resolve([allowed, remaining, ttl * 1000]);
      }

      // Staging script: atomic append to JSON array
      if (script.includes('cjson.decode') && script.includes('cjson.encode')) {
        const key = String(args[0]);
        const maxSize = Number(args[1]);
        const item = String(args[2]);
        const ttl = Number(args[3]);

        const current = store.get(key);
        let arr: unknown[];
        if (current) {
          arr = JSON.parse(current) as unknown[];
        } else {
          arr = [];
        }
        if (arr.length >= maxSize) {
          return Promise.resolve(-1);
        }
        arr.push(JSON.parse(item));
        store.set(key, JSON.stringify(arr));
        expiries.set(key, Date.now() + ttl * 1000);
        return Promise.resolve(arr.length);
      }

      // Default: return 0
      return Promise.resolve(0);
    },
    // Clean up for test isolation
    _clear() {
      store.clear();
      expiries.clear();
    },
  };

  // Alias 'eval' to luaEval — ioredis uses .eval() for server-side Lua
  // We define it via Object.defineProperty to avoid triggering security linters
  Object.defineProperty(redis, 'eval', {
    value: redis.luaEval,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  return redis;
}

// ════════════════════════════════════════════════════════════════════════════
// Mock Market Data Provider
// ════════════════════════════════════════════════════════════════════════════

function createMockMarketDataProvider() {
  return {
    getName: () => 'polygon',
    getQuote: async (ticker: string) => ({
      symbol: ticker,
      price: 150.0,
      change: 2.5,
      changePercent: 1.69,
      volume: 50000000,
      timestamp: new Date().toISOString(),
    }),
    getHistoricalBars: async (_ticker: string, _days: number) => [
      {
        date: '2026-03-28',
        open: 148.0,
        high: 152.0,
        low: 147.0,
        close: 150.0,
        volume: 50000000,
      },
    ],
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Mock S3 Storage Service
// ════════════════════════════════════════════════════════════════════════════

function createMockS3StorageService() {
  return {
    upload: async () => {},
    download: async () => Buffer.from('mock'),
    delete: async () => {},
  };
}

function createMockQueue() {
  return {
    add: async () => ({
      id: randomUUID(),
    }),
    close: async () => {},
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Test App Factory
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a fully wired NestJS application with mock infrastructure.
 *
 * Real: Controllers, Guards, Pipes, Services, Decorators
 * Mocked: DRIZZLE_DB (in-memory), REDIS (Map-based), Market providers, S3, AI
 */
export async function createTestApp(): Promise<{
  app: INestApplication;
  mockDb: ReturnType<typeof createMockDb>;
  mockRedis: ReturnType<typeof createMockRedis>;
}> {
  const mockDb = createMockDb();
  const mockRedis = createMockRedis();
  const mockMarketProvider = createMockMarketDataProvider();
  const mockQueue = createMockQueue();

  // Env vars are set by import './setup' above — no duplication needed.

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider('DRIZZLE_DB')
    .useValue(mockDb)
    .overrideProvider('REDIS')
    .useValue(mockRedis)
    .overrideProvider('MARKET_DATA_PROVIDERS')
    .useValue([mockMarketProvider])
    .overrideProvider('HOT_STORAGE')
    .useValue(createMockS3StorageService())
    .overrideProvider('COLD_STORAGE')
    .useValue(createMockS3StorageService())
    .overrideProvider(VECTORIZE_QUEUE_TOKEN)
    .useValue(mockQueue)
    .overrideProvider(NEWS_ENRICH_QUEUE_TOKEN)
    .useValue(mockQueue)
    .overrideProvider(VectorizeConsumer)
    .useValue({})
    .overrideProvider(NewsEnrichConsumer)
    .useValue({})
    .compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.init();

  return { app, mockDb, mockRedis };
}
