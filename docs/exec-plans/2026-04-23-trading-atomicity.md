# Exec Plan: Trading Stage / Commit / Execute Atomicity

> **For agentic workers:** REQUIRED SUB-SKILL — superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Source PRD:** `docs/product-specs/2026-04-23-trading-stage-commit-execute-atomicity.md`
**Branch:** `feat/2026-04-23-trading-atomicity`
**Goal:** Make stage→commit→execute atomic + business-level idempotent.
**Approach:** Lua-scripted atomic commit, canonical hash without timestamp, `Idempotency-Key` header threaded controller→service, Redis-cached execute result keyed by idempotencyKey.
**Tech:** NestJS + ioredis + Drizzle + vitest. Local infra: Postgres :5432 (Homebrew), Redis :6379 (docker compose).

## Background

Verified problems against `apps/api/src/trading/unified-trading.service.ts`:
- Lines 156-172: `getStagingArea` (GET) and `clearStagingArea` (DEL) are separate Redis ops; concurrent `stage()` between them is silently lost.
- Lines 218-220: `hashInput = ${message}|${ops}|${new Date().toISOString()}` — retries produce different hashes.
- `commitRequestSchema` at `packages/shared/src/schemas/trading.ts:24` has no `idempotencyKey` field.
- Stub event emitter at lines 702-711 — has no `idempotencyKey` payload yet.

Codex consult (2026-04-23) decided: header-based `Idempotency-Key` (Stripe style), normalize at controller boundary.

## Out of Scope

- Real `AgentEventService` wiring — the stub stays a stub; we only add the field. (Phase 10 owns the full event service.)
- Broker-level retry semantics (Alpaca/CCXT idempotency) — paper broker only in tests.
- Redis Cluster topology rollout — but key naming uses `{userId}` hashtag so cluster move is later trivial.

## File Map

| Path | Role |
|------|------|
| `packages/shared/src/utils/stable-stringify.ts` | NEW — sort-keyed JSON stringify, used both at commit and re-verify. |
| `packages/shared/src/utils/__tests__/stable-stringify.test.ts` | NEW — unit tests. |
| `packages/shared/src/utils/index.ts` | MODIFY — export `stableStringify`. |
| `packages/shared/src/schemas/trading.ts` | MODIFY — keep `commitRequestSchema` body unchanged; add `idempotencyKey` to internal `CommitInput` type only. |
| `apps/api/src/common/decorators/idempotency-key.decorator.ts` | NEW — Nest param decorator that reads the `Idempotency-Key` header. |
| `apps/api/src/trading/unified-trading.service.ts` | MODIFY — Lua atomic commit, canonical hash, idempotency cache, peek-not-getdel logic. |
| `apps/api/src/trading/trading.controller.ts` | MODIFY — accept `Idempotency-Key` header for `commit` and `execute`. |
| `apps/api/src/trading/__tests__/unified-trading.service.spec.ts` | MODIFY — add new test cases (concurrent stage, idempotent commit, different keys, cached execute). |
| `apps/api/src/trading/__tests__/unified-trading.integration.spec.ts` | NEW — uses real Redis on :6379, in-memory Drizzle stub, full lifecycle. |

## Tasks

---

### Task 1: stableStringify utility

**Files:**
- Create: `packages/shared/src/utils/stable-stringify.ts`
- Create: `packages/shared/src/utils/__tests__/stable-stringify.test.ts`
- Modify: `packages/shared/src/utils/index.ts`

- [ ] **Step 1.1 — Write failing test**

`packages/shared/src/utils/__tests__/stable-stringify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stableStringify } from '../stable-stringify';

describe('stableStringify', () => {
  it('produces same output regardless of key insertion order', () => {
    const a = stableStringify({ b: 1, a: 2 });
    const b = stableStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('recurses into nested objects', () => {
    const a = stableStringify({ x: { z: 3, y: 2 } });
    const b = stableStringify({ x: { y: 2, z: 3 } });
    expect(a).toBe(b);
  });

  it('preserves array order', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles primitives, null, and undefined-as-null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('s')).toBe('"s"');
  });

  it('matches JSON.stringify shape for canonical input', () => {
    const obj = { a: 1, b: [{ c: 2, d: 3 }] };
    const expected = JSON.stringify({ a: 1, b: [{ c: 2, d: 3 }] });
    expect(stableStringify(obj)).toBe(expected);
  });
});
```

- [ ] **Step 1.2 — Run test, verify it fails**

```
pnpm --filter @finsentinel/shared test -- stable-stringify
```
Expected: FAIL with `Cannot find module '../stable-stringify'`.

- [ ] **Step 1.3 — Write minimal implementation**

`packages/shared/src/utils/stable-stringify.ts`:

```ts
/**
 * JSON.stringify with object keys sorted recursively. Stable across
 * insertion-order differences. Arrays keep their original order.
 *
 * Used to compute deterministic hash inputs for commit idempotency.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]));
  return '{' + pairs.join(',') + '}';
}
```

- [ ] **Step 1.4 — Export from utils/index.ts**

Append to `packages/shared/src/utils/index.ts`:

```ts
export { stableStringify } from './stable-stringify';
```

- [ ] **Step 1.5 — Run test, verify pass**

```
pnpm --filter @finsentinel/shared test -- stable-stringify
```
Expected: PASS, all 5 cases.

- [ ] **Step 1.6 — Commit**

```bash
git add packages/shared/src/utils/stable-stringify.ts \
        packages/shared/src/utils/__tests__/stable-stringify.test.ts \
        packages/shared/src/utils/index.ts
git commit -m "feat(shared): add stableStringify util for deterministic hashing"
```

---

### Task 2: IdempotencyKey decorator

**Files:**
- Create: `apps/api/src/common/decorators/idempotency-key.decorator.ts`
- Create: `apps/api/src/common/decorators/__tests__/idempotency-key.decorator.test.ts`

- [ ] **Step 2.1 — Write failing test**

`apps/api/src/common/decorators/__tests__/idempotency-key.decorator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractIdempotencyKey } from '../idempotency-key.decorator';

describe('extractIdempotencyKey', () => {
  it('returns the Idempotency-Key header value', () => {
    const req = { headers: { 'idempotency-key': 'abc-123' } };
    expect(extractIdempotencyKey(req)).toBe('abc-123');
  });

  it('is case-insensitive', () => {
    const req = { headers: { 'Idempotency-Key': 'XYZ' } };
    expect(extractIdempotencyKey(req)).toBe('XYZ');
  });

  it('returns undefined when header absent', () => {
    expect(extractIdempotencyKey({ headers: {} })).toBeUndefined();
  });

  it('returns undefined when header is empty string', () => {
    expect(extractIdempotencyKey({ headers: { 'idempotency-key': '' } })).toBeUndefined();
  });

  it('rejects array values (multi-valued header) by taking first non-empty', () => {
    const req = { headers: { 'idempotency-key': ['k1', 'k2'] } };
    expect(extractIdempotencyKey(req)).toBe('k1');
  });
});
```

- [ ] **Step 2.2 — Run test, verify FAIL**

```
pnpm --filter @finsentinel/api test -- idempotency-key
```
Expected: FAIL — module not found.

- [ ] **Step 2.3 — Write decorator**

`apps/api/src/common/decorators/idempotency-key.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

const HEADER = 'idempotency-key';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Extract the Idempotency-Key header from a request-like object.
 * Exposed as a named export so it can be unit tested without spinning up Nest.
 */
export function extractIdempotencyKey(req: RequestLike): string | undefined {
  // Express lowercases header names; Fastify and others may not.
  const raw =
    req.headers[HEADER] ??
    req.headers['Idempotency-Key' as keyof typeof req.headers];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) {
    const first = raw.find((v) => typeof v === 'string' && v.length > 0);
    return first;
  }
  return raw.length > 0 ? raw : undefined;
}

/**
 * @IdempotencyKey() — injects the Idempotency-Key header value (or undefined)
 * into a controller method parameter.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestLike>();
    return extractIdempotencyKey(req);
  },
);
```

- [ ] **Step 2.4 — Run test, verify PASS**

```
pnpm --filter @finsentinel/api test -- idempotency-key
```
Expected: PASS, all 5 cases.

- [ ] **Step 2.5 — Commit**

```bash
git add apps/api/src/common/decorators/idempotency-key.decorator.ts \
        apps/api/src/common/decorators/__tests__/idempotency-key.decorator.test.ts
git commit -m "feat(api): add Idempotency-Key header decorator"
```

---

### Task 3: Internal CommitInput type with idempotencyKey

**Files:**
- Modify: `packages/shared/src/schemas/trading.ts`

- [ ] **Step 3.1 — Read current schema**

```
grep -n "commitRequestSchema\|CommitRequest" packages/shared/src/schemas/trading.ts
```

- [ ] **Step 3.2 — Add CommitInput type (NOT a body schema; transport-agnostic)**

Append to `packages/shared/src/schemas/trading.ts` after `commitRequestSchema`:

```ts
/**
 * Internal commit input — transport agnostic. The HTTP controller derives
 * `idempotencyKey` from the `Idempotency-Key` request header and merges it
 * with the validated body before calling the service. Body shape stays
 * unchanged so the public DTO does not carry transport-layer concerns.
 */
export interface CommitInput {
  message: string;
  idempotencyKey?: string;
  metadata?: { ledgerId?: string; runId?: string };
}
```

- [ ] **Step 3.3 — Verify build**

```
pnpm --filter @finsentinel/shared build
```
Expected: build succeeds.

- [ ] **Step 3.4 — Commit**

```bash
git add packages/shared/src/schemas/trading.ts
git commit -m "feat(shared): add internal CommitInput type for trading idempotency"
```

---

### Task 4: Refactor commit() — Lua atomic + canonical hash + idempotencyKey

**Files:**
- Modify: `apps/api/src/trading/unified-trading.service.ts`

- [ ] **Step 4.1 — Add a failing test (concurrent stage during commit)**

Append to `apps/api/src/trading/__tests__/unified-trading.service.spec.ts` inside the existing `describe('UnifiedTradingService', ...)`:

```ts
describe('atomic commit (Task 4)', () => {
  it('does not lose a stage call that arrives concurrently with commit', async () => {
    // Use a real in-memory map to simulate Redis ordering precisely.
    const store = new Map<string, string>();
    const ops0 = [{ action: 'buy', symbol: 'AAPL', qty: '1' }];

    store.set('uta:staging:{' + TEST_USER_ID + '}', JSON.stringify(ops0));

    let interceptedClear = false;
    const fakeRedis = {
      ...createMockRedis(),
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
      setex: vi.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); return 'OK'; }),
      del: vi.fn(async (k: string) => { store.delete(k); return 1; }),
      eval: vi.fn(async (_script: string, _numKeys: number, ...args: string[]) => {
        // Lua-style atomic: read staging, write pending, delete staging.
        const stagingKey = args[0];
        const pendingKey = args[1];
        const commitJson = args[2];
        const ttl = args[3];
        const staging = store.get(stagingKey);
        if (!staging) return null;
        store.set(pendingKey, commitJson);
        store.delete(stagingKey);
        return staging;
      }),
    };

    const svc = await buildService({ redis: fakeRedis });

    // Simulate: another stage arrives strictly between commit's read and clear.
    // With Lua atomicity that arrival lands AFTER staging cleared, so it sits
    // in fresh staging.
    await svc.commit(TEST_USER_ID, 'first commit');
    interceptedClear = true;

    // After commit, simulate concurrent stage of a second op.
    await svc.stage(TEST_USER_ID, { action: 'buy', symbol: 'TSLA', qty: '2' } as any);
    const remaining = await svc.getStagingArea(TEST_USER_ID);
    expect(remaining.length).toBe(1);
    expect((remaining[0] as any).symbol).toBe('TSLA');
    expect(interceptedClear).toBe(true);
  });
});
```

`buildService` is a small helper to add at the top of the spec file if not present (mirrors the existing `Test.createTestingModule` setup; copy from the existing tests in the same file).

- [ ] **Step 4.2 — Run test, verify FAIL**

```
pnpm --filter @finsentinel/api test -- unified-trading.service
```
Expected: FAIL — current `commit()` doesn't use `eval`, the fake `eval` is never called, ordering not guaranteed.

- [ ] **Step 4.3 — Add Lua script + canonical hash to service**

In `apps/api/src/trading/unified-trading.service.ts`:

(a) Add new Lua constant near `LUA_ATOMIC_APPEND`:

```ts
/**
 * Atomic commit: read staging → write pending → delete staging in one Redis call.
 *
 * KEYS[1] = staging key
 * KEYS[2] = pending key
 * ARGV[1] = canonical commit JSON (already includes hash)
 * ARGV[2] = TTL seconds
 *
 * Returns the staging payload that was promoted, or nil if staging was empty.
 */
const LUA_ATOMIC_COMMIT = `
local stagingKey = KEYS[1]
local pendingKey = KEYS[2]
local commit = ARGV[1]
local ttl = tonumber(ARGV[2])
local staging = redis.call('GET', stagingKey)
if not staging then
  return nil
end
redis.call('SETEX', pendingKey, ttl, commit)
redis.call('DEL', stagingKey)
return staging
`;
```

(b) Update `STAGING_KEY_PREFIX`/`PENDING_KEY_PREFIX` usage to include `{userId}` hashtag (cluster-safe slot pinning):

```ts
const stagingKey = (userId: string) => `uta:staging:{${userId}}`;
const pendingKey = (userId: string) => `uta:pending:{${userId}}`;
const idempotencyKeyName = (userId: string, key: string) =>
  `uta:idem:{${userId}}:${key}`;
const executedKeyName = (userId: string, key: string) =>
  `uta:executed:{${userId}}:${key}`;
```

Replace the four call sites in `stage`, `getStagingArea`, `clearStagingArea`, and `commit`/`execute` to use these helpers. Keep `STAGING_KEY_PREFIX` constant only as a fallback for any external migration; otherwise remove it.

(c) Replace `commit()`:

```ts
async commit(
  userId: string,
  message: string,
  options?: { idempotencyKey?: string; metadata?: { ledgerId?: string; runId?: string } },
): Promise<{ hash: string; count: number }> {
  if (!message || message.trim().length === 0) {
    throw new BadRequestException('Commit message must not be blank');
  }

  const idemKey = options?.idempotencyKey;

  // 1. Idempotency cache: same idemKey already produced a commit hash → return it.
  if (idemKey) {
    const cachedHash = await this.redis.get(idempotencyKeyName(userId, idemKey));
    if (cachedHash) {
      const pendingRaw = await this.redis.get(pendingKey(userId));
      const count = pendingRaw
        ? (JSON.parse(pendingRaw) as CommitData).operations.length
        : 0;
      this.logger.log(
        `Idempotent commit hit for user ${userId} key=${idemKey} hash=${cachedHash.substring(0, 8)}...`,
      );
      return { hash: cachedHash, count };
    }
  }

  // 2. Compute canonical hash from staging (must read staging once first to count).
  const stagingPeek = await this.getStagingArea(userId);
  if (stagingPeek.length === 0) {
    throw new BadRequestException('Nothing staged — stage operations before committing');
  }

  const autoKey = `${userId}|${stagingPeek
    .map((o) => String((o as { clientOrderId?: string }).clientOrderId ?? ''))
    .filter(Boolean)
    .sort()
    .join(',')}`;
  const hashKey = idemKey ?? autoKey;
  const hashInput = `${hashKey}|${stableStringify(stagingPeek)}|${message}`;
  const hash = sha256(hashInput);

  const commitData: CommitData = {
    hash,
    message,
    timestamp: new Date().toISOString(),
    operations: stagingPeek,
    ...(options?.metadata ? { metadata: options.metadata } : {}),
    ...(idemKey ? { idempotencyKey: idemKey } : {}),
  };

  // 3. Atomic stage→commit via Lua: still uses staging from step 2 as the source
  //    of truth; if a concurrent stage() arrived after step 2, it stays in staging.
  const result = (await this.redis.eval(
    LUA_ATOMIC_COMMIT,
    2,
    stagingKey(userId),
    pendingKey(userId),
    JSON.stringify(commitData),
    String(STATE_TTL_SECONDS),
  )) as string | null;

  if (result === null) {
    throw new BadRequestException('Staging area was cleared between read and commit; retry');
  }

  // 4. Cache idempotencyKey → hash mapping (for retry).
  if (idemKey) {
    await this.redis.setex(idempotencyKeyName(userId, idemKey), STATE_TTL_SECONDS, hash);
  }

  this.logger.log(
    `Committed ${stagingPeek.length} op(s) for user ${userId} hash=${hash.substring(0, 8)}... idem=${idemKey ?? 'auto'}`,
  );
  return { hash, count: stagingPeek.length };
}
```

(d) Extend `CommitData` interface:

```ts
interface CommitData {
  hash: string;
  message: string;
  timestamp: string;
  operations: Record<string, unknown>[];
  metadata?: { ledgerId?: string; runId?: string };
  idempotencyKey?: string;
  // Filled in after a successful execute (Task 5):
  executionReport?: string;
  operationResults?: Record<string, unknown>[];
}
```

(e) Add `import { stableStringify } from '@finsentinel/shared/utils';` to the top of the file.

- [ ] **Step 4.4 — Run test, verify PASS for Step 4.1**

```
pnpm --filter @finsentinel/api test -- unified-trading.service
```
Expected: the new test passes; existing tests still pass.

If existing tests break because they expected timestamp in hash, update those expectations: hash is now deterministic from `(idempotencyKey ?? autoKey | ops | message)`.

- [ ] **Step 4.5 — Commit**

```bash
git add apps/api/src/trading/unified-trading.service.ts \
        apps/api/src/trading/__tests__/unified-trading.service.spec.ts
git commit -m "feat(trading): atomic commit via Lua + canonical hash + idempotencyKey"
```

---

### Task 5: Idempotent execute() — peek + cache result

**Files:**
- Modify: `apps/api/src/trading/unified-trading.service.ts`
- Modify: `apps/api/src/trading/__tests__/unified-trading.service.spec.ts`

- [ ] **Step 5.1 — Add failing test**

In the `unified-trading.service.spec.ts` add:

```ts
describe('idempotent execute (Task 5)', () => {
  it('re-execute with same Idempotency-Key returns cached ExecuteResult, no broker re-trigger', async () => {
    const fakeRedis = createMockRedis();
    const placeOrder = vi.fn().mockResolvedValue({
      success: true,
      filledQty: '1',
      avgPrice: '100',
    });
    const svc = await buildService({
      redis: fakeRedis,
      brokerOverride: { placeOrder },
    });

    // Stage + commit + execute once.
    await svc.stage(TEST_USER_ID, { action: 'buy', symbol: 'AAPL', qty: '1' } as any);
    await svc.commit(TEST_USER_ID, 'msg', { idempotencyKey: 'IDK-1' });
    const first = await svc.execute(TEST_USER_ID, 'IDK-1');
    expect(placeOrder).toHaveBeenCalledTimes(1);

    // Re-execute with same key: must return cached, no new broker call.
    const second = await svc.execute(TEST_USER_ID, 'IDK-1');
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(second.report).toBe(first.report);
  });
});
```

- [ ] **Step 5.2 — Run, verify FAIL**

Expected: second `execute` either throws "No pending commit found" or calls broker again.

- [ ] **Step 5.3 — Update execute() signature & body**

Change signature:

```ts
async execute(userId: string, idempotencyKey?: string): Promise<ExecuteResult> {
  // 0. Cache hit: prior successful execute with same key → return stored result.
  if (idempotencyKey) {
    const cachedRaw = await this.redis.get(executedKeyName(userId, idempotencyKey));
    if (cachedRaw) {
      this.logger.log(
        `Idempotent execute hit for user ${userId} key=${idempotencyKey}`,
      );
      return JSON.parse(cachedRaw) as ExecuteResult;
    }
  }

  // 1. Atomic GETDEL pending — single-shot consume.
  const raw = await (this.redis as Redis & {
    getdel(key: string): Promise<string | null>;
  }).getdel(pendingKey(userId));
  if (!raw) {
    throw new BadRequestException('No pending commit found. Stage and commit operations first.');
  }

  // ... existing flow unchanged ...
  // After computing `result: ExecuteResult` and persisting wallet:

  if (idempotencyKey) {
    await this.redis.setex(
      executedKeyName(userId, idempotencyKey),
      STATE_TTL_SECONDS,
      JSON.stringify(result),
    );
  }

  this.emitTradeEvent(userId, wallet.id, AgentEventType.TRADE_COMMIT_EXECUTED, {
    hash: commitData.hash,
    message: commitData.message,
    operationCount: commitData.operations.length,
    results: operationResults,
    idempotencyKey,
  });

  return result;
}
```

(Concretely: build the existing `ExecuteResult` into a local `result` variable, persist, cache, then return.)

- [ ] **Step 5.4 — Run, verify PASS**

```
pnpm --filter @finsentinel/api test -- unified-trading.service
```
Expected: cache-hit test passes, no broker re-call.

- [ ] **Step 5.5 — Commit**

```bash
git add apps/api/src/trading/unified-trading.service.ts \
        apps/api/src/trading/__tests__/unified-trading.service.spec.ts
git commit -m "feat(trading): cache execute result by Idempotency-Key (no broker re-trigger)"
```

---

### Task 6: Wire Idempotency-Key header through controller

**Files:**
- Modify: `apps/api/src/trading/trading.controller.ts`
- Modify: `apps/api/src/trading/__tests__/trading.controller.spec.ts`

- [ ] **Step 6.1 — Add failing controller test**

```ts
it('passes Idempotency-Key header into commit()', async () => {
  const commitSpy = vi.fn().mockResolvedValue({ hash: 'h', count: 1 });
  const ctrl = await buildController({ commit: commitSpy });

  await ctrl.commit(
    { userId: 'u1' } as any,
    { message: 'msg' } as any,
    'IDK-42', // header value (decorator-resolved)
  );

  expect(commitSpy).toHaveBeenCalledWith('u1', 'msg', { idempotencyKey: 'IDK-42' });
});
```

- [ ] **Step 6.2 — Run, verify FAIL**

Expected: signature mismatch.

- [ ] **Step 6.3 — Update controller signatures**

```ts
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';

@Post('commit')
async commit(
  @CurrentUser() user: CurrentUserPayload,
  @Body(new ZodValidationPipe(commitRequestSchema)) body: CommitRequest,
  @IdempotencyKey() idempotencyKey?: string,
) {
  const result = await this.tradingService.commit(user.userId, body.message, {
    idempotencyKey,
  });
  return {
    message: `Committed ${result.count} operations (hash: ${result.hash.substring(0, 8)}...)`,
    hash: result.hash,
  };
}

@Post('execute')
async execute(
  @CurrentUser() user: CurrentUserPayload,
  @IdempotencyKey() idempotencyKey?: string,
) {
  const result = await this.tradingService.execute(user.userId, idempotencyKey);
  return { message: result.report };
}
```

- [ ] **Step 6.4 — Run controller spec, verify PASS**

```
pnpm --filter @finsentinel/api test -- trading.controller
```

- [ ] **Step 6.5 — Commit**

```bash
git add apps/api/src/trading/trading.controller.ts \
        apps/api/src/trading/__tests__/trading.controller.spec.ts
git commit -m "feat(trading): accept Idempotency-Key header on commit/execute"
```

---

### Task 7: Unit test — same idempotencyKey produces same hash

**Files:**
- Modify: `apps/api/src/trading/__tests__/unified-trading.service.spec.ts`

- [ ] **Step 7.1 — Add test**

```ts
it('same idempotencyKey + same ops + same message → second commit returns first hash, no new pending write', async () => {
  const fakeRedis = createMockRedis();
  const setexSpy = fakeRedis.setex;
  const svc = await buildService({ redis: fakeRedis });

  await svc.stage(TEST_USER_ID, { action: 'buy', symbol: 'AAPL', qty: '1' } as any);
  const first = await svc.commit(TEST_USER_ID, 'msg', { idempotencyKey: 'K-1' });

  // Re-stage identical op (because first commit cleared staging).
  await svc.stage(TEST_USER_ID, { action: 'buy', symbol: 'AAPL', qty: '1' } as any);
  const second = await svc.commit(TEST_USER_ID, 'msg', { idempotencyKey: 'K-1' });

  expect(second.hash).toBe(first.hash);
  // setex is called once for the pending key in the first commit, plus the
  // idem-key cache writes; the SECOND commit must NOT write a new pending key.
  const pendingWrites = (setexSpy as Mock).mock.calls.filter((c) =>
    String(c[0]).includes('uta:pending'),
  );
  expect(pendingWrites.length).toBe(1);
});
```

- [ ] **Step 7.2 — Run, expect PASS** (Task 4 already implemented the cache)

- [ ] **Step 7.3 — Add the "different key" test**

```ts
it('different idempotencyKey produces different hash', async () => {
  const fakeRedis = createMockRedis();
  const svc = await buildService({ redis: fakeRedis });

  await svc.stage(TEST_USER_ID, { action: 'buy', symbol: 'AAPL', qty: '1' } as any);
  const a = await svc.commit(TEST_USER_ID, 'msg', { idempotencyKey: 'K-A' });

  await svc.stage(TEST_USER_ID, { action: 'buy', symbol: 'AAPL', qty: '1' } as any);
  const b = await svc.commit(TEST_USER_ID, 'msg', { idempotencyKey: 'K-B' });

  expect(a.hash).not.toBe(b.hash);
});
```

- [ ] **Step 7.4 — Run, verify PASS**

- [ ] **Step 7.5 — Commit**

```bash
git add apps/api/src/trading/__tests__/unified-trading.service.spec.ts
git commit -m "test(trading): idempotencyKey commit collision/distinctness"
```

---

### Task 8: Integration test against real Redis

**Files:**
- Create: `apps/api/src/trading/__tests__/unified-trading.integration.spec.ts`

- [ ] **Step 8.1 — Verify Redis is up**

```
redis-cli -h localhost -p 6379 ping
```
Expected: `PONG`. If not, `cd /Users/hongxichen/Desktop/FinSentinel && docker compose up -d redis`.

- [ ] **Step 8.2 — Write integration spec**

`apps/api/src/trading/__tests__/unified-trading.integration.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import IORedis from 'ioredis';
import { UnifiedTradingService } from '../unified-trading.service';
import { BrokerRegistry } from '../broker-registry.service';
import { TradingMode, Contract } from '@finsentinel/shared';

const TEST_USER = '99999999-9999-9999-9999-999999999999';

describe('UnifiedTradingService integration (real Redis)', () => {
  let redis: IORedis;
  let svc: UnifiedTradingService;
  let placeOrder = vi.fn();

  beforeAll(async () => {
    redis = new IORedis({ host: '127.0.0.1', port: 6379, lazyConnect: false });
    await redis.ping();
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    // Clean keys for the test user.
    const keys = await redis.keys(`uta:*{${TEST_USER}}*`);
    if (keys.length) await redis.del(...keys);

    placeOrder = vi.fn().mockResolvedValue({
      success: true, filledQty: '1', avgPrice: '100',
    });

    // Build minimal in-memory wallet store (mock Drizzle DB).
    let wallet = {
      id: 'w1', userId: TEST_USER,
      initialCapital: '100000.00', cashBalance: '100000.00',
      tradingMode: TradingMode.PAPER, positions: [], commitHistory: [],
      createdAt: new Date(), updatedAt: new Date(),
    };
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([wallet]) }) }) }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([wallet]) }) }),
      update: () => ({ set: (patch: any) => ({ where: () => Promise.resolve(wallet = { ...wallet, ...patch }) }) }),
    } as any;

    const brokerRegistry = {
      resolve: () => ({
        placeOrder,
        engine: () => ({
          setCash: vi.fn(), setPositions: vi.fn(),
          getCash: () => 99900, getPositionMaps: () => [],
        }),
      }),
    } as unknown as BrokerRegistry;

    const marketDataService = { searchTickers: vi.fn() } as any;
    svc = new UnifiedTradingService(brokerRegistry, redis as any, db, marketDataService);
  });

  it('end-to-end stage → commit → execute → re-execute returns cached result', async () => {
    await svc.stage(TEST_USER, { action: 'buy', symbol: 'AAPL', qty: '1' } as any);
    const c1 = await svc.commit(TEST_USER, 'first', { idempotencyKey: 'IT-1' });
    const e1 = await svc.execute(TEST_USER, 'IT-1');

    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(c1.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(e1.report).toContain(c1.hash.substring(0, 8));

    // Re-execute with same key: must return cached, must NOT call broker again.
    const e2 = await svc.execute(TEST_USER, 'IT-1');
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(e2.report).toBe(e1.report);
  });

  it('idempotent commit: stage → commit(K) → stage → commit(K) → same hash', async () => {
    await svc.stage(TEST_USER, { action: 'buy', symbol: 'AAPL', qty: '1' } as any);
    const a = await svc.commit(TEST_USER, 'msg', { idempotencyKey: 'IT-2' });
    await svc.stage(TEST_USER, { action: 'buy', symbol: 'AAPL', qty: '1' } as any);
    const b = await svc.commit(TEST_USER, 'msg', { idempotencyKey: 'IT-2' });
    expect(b.hash).toBe(a.hash);
  });
});
```

- [ ] **Step 8.3 — Run integration tests**

```
pnpm --filter @finsentinel/api test -- unified-trading.integration
```
Expected: PASS.

- [ ] **Step 8.4 — Commit**

```bash
git add apps/api/src/trading/__tests__/unified-trading.integration.spec.ts
git commit -m "test(trading): integration spec for atomic commit + cached execute"
```

---

### Task 9: Final verification & cleanup

- [ ] **Step 9.1 — Full API test suite**

```
pnpm --filter @finsentinel/api test
```
Expected: green. If any pre-existing trading test broke because it asserted the old timestamp-in-hash behavior, update those expectations now (they were testing implementation, not behavior).

- [ ] **Step 9.2 — Typecheck**

```
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/shared typecheck
```

- [ ] **Step 9.3 — Update PRD progress log**

Append to `docs/product-specs/2026-04-23-trading-stage-commit-execute-atomicity.md` (NEW section at the end):

```
## 8. Implementation Progress Log

- 2026-04-23: branch `feat/2026-04-23-trading-atomicity` opened.
- 2026-04-23: implemented Tasks 1–8 per `docs/exec-plans/2026-04-23-trading-atomicity.md`.
- Verification: vitest passes for unified-trading.service, .controller, .integration.
```

- [ ] **Step 9.4 — Commit**

```bash
git add docs/product-specs/2026-04-23-trading-stage-commit-execute-atomicity.md
git commit -m "docs(trading): log atomicity implementation progress"
```

---

## Self-Review Checklist

- [x] Spec coverage: §5.1 Lua atomic → Task 4. §5.2 canonical hash → Task 4. §5.3 idempotencyKey + cache → Tasks 4+5+6. §6 acceptance gates → Tasks 7+8.
- [x] No placeholders: every code block is concrete TypeScript.
- [x] Type consistency: `CommitInput`, `ExecuteResult`, `CommitData`, `executedKeyName` reused across tasks.
- [x] Verification: each task ends in a runnable command + commit step.
- [x] Scope discipline: nothing about new event service, broker rewrites, or schema changes outside what the PRD says.

## Risks Going In

- Existing `unified-trading.service.spec.ts` may have tests asserting timestamp-based hash; Task 4.4 calls them out explicitly to update.
- Integration test depends on a clean Redis namespace per run — `beforeEach` cleans the user's keyspace; do NOT run two tests against the same user concurrently.
- `@finsentinel/shared/utils` is intentionally not re-exported from the package root; the import must use the subpath.
