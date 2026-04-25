# PRD: Trading order ledger + state machine (item 3)

Date: 2026-04-24
Status: Draft — supersedes the scope gap in `2026-04-23-trading-stage-commit-execute-atomicity.md`
Priority: P1

## 1. Relationship to prior work

`docs/product-specs/2026-04-23-trading-stage-commit-execute-atomicity.md` addresses the **stage→commit** race (Lua atomicity) and commit hash idempotency. It does **not** address the reviewer's deeper concern (item 3): `execute()` uses `GETDEL` to consume pending commits. If broker call / DB write / process crash happens mid-flight, the commit is gone from Redis and there is no persistent record of what happened.

This PRD lands the state machine and the order ledger that fixes that gap.

## 2. State machine

```
STAGED → COMMITTED → EXECUTING → EXECUTED
                  ↘          ↘     ↗
                   CANCELLED   PARTIALLY_FAILED
                                ↓
                              FAILED (terminal)
```

Transition rules:

- `STAGED → COMMITTED`: current Lua atomicity (tracked in prior PRD).
- `COMMITTED → EXECUTING`: **single atomic operation** (Redis Lua OR DB transaction). No more GETDEL-then-work. The pending key is NOT deleted; it's updated with `status=EXECUTING`, `executingAt=<ts>`, `lock=<worker-id>`.
- `EXECUTING → EXECUTED`: all broker ops succeeded. Persist to `order_ledger` table. Delete pending key.
- `EXECUTING → PARTIALLY_FAILED`: some ops filled, some failed. Persist each op's result to `order_ledger`. Pending key retained with partial results + `status=PARTIALLY_FAILED`; operator can retry or cancel.
- `EXECUTING → FAILED`: pre-broker validation failure (e.g., market closed). No orders placed. Persist a row with `status=FAILED` and reason. Clear pending.
- `COMMITTED → CANCELLED`: user action only; pending deleted; ledger row with `status=CANCELLED`.

## 3. Persistent `order_ledger`

New table (migration `V{next}__order_ledger.sql`):

```sql
CREATE TABLE order_ledger (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  commit_hash   VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(128),
  status        VARCHAR(32) NOT NULL CHECK (status IN
                  ('STAGED','COMMITTED','EXECUTING','EXECUTED',
                   'PARTIALLY_FAILED','FAILED','CANCELLED')),
  symbol        VARCHAR(32) NOT NULL,
  side          VARCHAR(8)  NOT NULL,
  qty           VARCHAR(64),        -- decimal string
  amount        VARCHAR(64),
  price         VARCHAR(64),
  broker        VARCHAR(32) NOT NULL,       -- 'paper' | 'alpaca' | 'okx' | 'ccxt'
  broker_order_id VARCHAR(128),              -- null until placed
  broker_request  JSONB NOT NULL,            -- full request payload
  broker_response JSONB,                     -- full response (nullable on pre-placement failure)
  error_reason  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX order_ledger_user_created_idx ON order_ledger(user_id, created_at DESC);
CREATE INDEX order_ledger_commit_hash_idx  ON order_ledger(commit_hash);
CREATE INDEX order_ledger_idempotency_idx  ON order_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX order_ledger_broker_status_idx ON order_ledger(broker, status);
```

### Drizzle schema

`packages/db/src/schema/trading/order-ledger.ts` following existing conventions. Don't forget the shared enum in `packages/shared/src/enums/order-status.ts`.

## 4. Idempotency persistence

Replace Redis-only idempotency cache with ledger-first + Redis accelerator:

- Commit with an idempotency key → first check Redis; miss → check `order_ledger WHERE idempotency_key = ?`.
- Cache the full `ExecuteResult` (including status + per-op outcome) in Redis for fast retries.
- Retry after pending consumed → ledger lookup still works.

## 5. Execute flow (new)

```ts
async execute(userId, idempotencyKey?) {
  // 0. Idempotency — Redis hit
  if (cached) return cached;

  // 1. Ledger idempotency — scan order_ledger (covered by index)
  if (idempotencyKey) {
    const prior = await this.orderLedger.findByIdempotency(userId, idempotencyKey);
    if (prior) return this.hydrateFromLedger(prior);
  }

  // 2. Atomic transition COMMITTED → EXECUTING
  //    Lua script updates pending key status + writes EXECUTING rows to DB
  //    in a single tx (via outbox pattern if truly atomic across Redis+PG required).
  const rowIds = await this.transitionToExecuting(userId, workerId);
  if (!rowIds) throw new BadRequestException('No committed operations to execute');

  // 3. For each op, call broker, update the matching ledger row.
  //    If broker call throws: row status = FAILED with reason; continue.
  //    If broker call fills: row status = EXECUTED with broker_order_id + response.
  //    Summarize: if all EXECUTED → final status EXECUTED;
  //    if mixed → PARTIALLY_FAILED; if all FAILED → FAILED.

  // 4. Emit events for each terminal transition via (new) AgentEventService.
  //    This replaces the current stub `emitTradeEvent` log line.
}
```

## 6. Migration

- Runtime reads both legacy `wallet.commitHistory` and new `order_ledger` for a transitional window (1 release).
- Write path dual-writes for that window; toggle via `TRADING_LEDGER_DUAL_WRITE=true` (default true for 1 release).
- After the window, remove the `commitHistory` field from the wallet schema in a follow-up PR.

## 7. Testing

- Unit: state machine transitions (16 legal, N illegal rejected).
- Unit: idempotency — same key after pending consumed returns same ExecuteResult.
- Integration (with ephemeral PG): execute → broker throws → ledger row FAILED, wallet unchanged.
- Integration: execute → broker fills partial → ledger has 2 EXECUTED + 1 FAILED rows, final status PARTIALLY_FAILED.
- Chaos: kill the node process between broker response and ledger write → on restart, reconciler finds EXECUTING rows older than 60s and either re-queries broker for status OR marks as UNKNOWN for operator review.

## 8. Reconciler (new, small service)

```
apps/api/src/trading/reconciler/ledger-reconciler.service.ts
```

Cron-driven (every 30s) scan of `WHERE status='EXECUTING' AND updated_at < now() - interval '60 seconds'`. For each: query broker for order status by broker_order_id; if found, transition to EXECUTED/FAILED; if not found, mark UNKNOWN with a `requires_operator_review` boolean.

## 9. Sequencing

- M1 (depends on `2026-04-23-trading-stage-commit-execute-atomicity` landing): ledger table + schema + dual-write.
- M2: state machine + new execute flow, feature-flagged via `TRADING_STATE_MACHINE_ENABLED=true`.
- M3: reconciler.
- M4: remove legacy `commitHistory` path.

Total effort: ~2 engineer-weeks. **Do not bundle M4 with M1–M3.**

## 10. Cross-PRD dependencies

- Item 4 (decimal money): ledger columns are strings by design — this PRD does not prescribe arithmetic, just storage. Item 4 lands decimal arithmetic inside execute. Either can land first; they don't conflict.
- Item 5 (live-trading guards): **blocks on M2 here**. Per-order caps and kill switch plug into the ledger-write step.

## 11. Owner

TBD — needs explicit signoff because this touches the critical trading path.

## 12. Progress log

### 2026-04-24 — M1 order_ledger table + dual-write (DONE, commit `43441a4`)

Shipped:
- `packages/db/migrations/V23__order_ledger.sql` — table with status CHECK constraint (`STAGED`, `COMMITTED`, `EXECUTING`, `EXECUTED`, `PARTIALLY_FAILED`, `FAILED`, `CANCELLED`), four indexes (user+created DESC, commit_hash, idempotency-where-not-null, broker+status), FK to users with `ON DELETE CASCADE`. Decimal-string columns for qty/amount/price per §3.
- `packages/db/src/schema/order-ledger.ts` — Drizzle schema mirroring V23, `ORDER_LEDGER_STATUSES` const + `OrderLedgerStatus` type. Re-exported from package root.
- `apps/api/src/trading/order-ledger/order-ledger.service.ts` — three methods: `recordExecutionResults`, `findByIdempotency`, `findByCommitHash`. Each operation in a commit becomes one row; success → `EXECUTED`, failure → `FAILED` with `errorReason`. Side derived from action (close → sell, sell → sell, else → buy).
- `apps/api/src/trading/unified-trading.service.ts` — dual-write hook in `execute()` AFTER the wallet persist (step 6b), wrapped in `try/catch` with WARN log. Failure to write the ledger does NOT abort the trading flow — wallet remains the system of record during this M1 window.
- `apps/api/src/trading/trading.module.ts` — `OrderLedgerService` registered as provider + exported.

Tests:
- `apps/api/src/trading/order-ledger/__tests__/order-ledger.service.spec.ts`: 9/9 green (insert mapping, success → EXECUTED, failure → FAILED with reason, side derivation incl. close → sell, no-op on empty operations, decimal string serialization, find-by-idempotency / find-by-commit-hash).
- `unified-trading.service.spec.ts`: 23/23 green (extended with stub `OrderLedgerService` provider).
- `src/__tests__/integration/trading-flow.integration.spec.ts`: 7/7 green (real `OrderLedgerService` against the integration mock DB — confirms the dual-write path doesn't break end-to-end).
- `pnpm --filter @finsentinel/api typecheck` clean.

What this milestone does NOT do (per scope):
- No state machine flip — `execute()` still uses `GETDEL` to consume pending; `wallet.commitHistory` is still the system of record.
- No EXECUTING-status transition; no PARTIALLY_FAILED handling; no reconciler.
- order_ledger rows are written-only — no read paths consume them in production yet.

### Deferred (M2 / M3 / M4)

- **M2** (DONE on `feat/2026-04-25-trading-state-machine-and-auth-refresh`, see entry below).
- **M3** (queued, depends on M2): cron-driven reconciler scanning `WHERE status='EXECUTING' AND updated_at < now() - 60s`, querying broker for status, transitioning row. M2's durable-first ordering (see fix `4fccae4`) makes the reconciler's job tractable — stuck rows are guaranteed to exist when needed.
- **M4** (queued): remove legacy `wallet.commitHistory` dual-write once M2 + M3 have soaked.

### 2026-04-25 — M2 state machine flip (DONE on branch, NOT merged to main)

Branch: `feat/2026-04-25-trading-state-machine-and-auth-refresh`. Commits:
- `f2e1cbb` — `feat(trading): state machine flip behind TRADING_STATE_MACHINE_ENABLED (item 3 M2)` — initial implementation.
- `4fccae4` — `fix(trading): durable-first state machine — INSERT EXECUTING before DEL pending` — fixed an atomicity hole that contradicted the "ledger as system of record" claim (see "Known gaps" below).

**Feature flag:** `TRADING_STATE_MACHINE_ENABLED`, default `false`. Validated in `env.validation.ts` (commit `e254a1e`).

Shipped:
- `OrderLedgerService` gained three M2 methods:
  - `recordExecuting(input)` — inserts one EXECUTING row per operation, returns row ids in operation order so the caller can pair broker outcomes back to rows.
  - `transitionFromExecuting(rowIds, outcomes)` — strict-length-invariant per-row UPDATE to EXECUTED or FAILED with `broker_response` / `error_reason`.
  - `transitionAll(rowIds, status, errorReason)` — bulk-set for pre-broker cancel/fail paths.
- `unified-trading.service.execute()` reads `tradingFlags()` once at the top, then branches at four points: ledger-first idempotency by `(user, idempotency_key)`; legacy hash-idempotency via `wallet.commitHistory` SKIP when flag-on; EXECUTING insert BEFORE broker invocation (durable-first ordering — see below); wallet persistence omits `commitHistory` from the `.set()` when flag-on; post-broker calls `transitionFromExecuting` instead of the M1 dual-write `recordExecutionResults`.

**Durable-first ordering (commit `4fccae4`):**
- Read pending with `GET` (not `GETDEL`) on flag-on.
- INSERT EXECUTING rows.
- DEL pending only AFTER the INSERT succeeds.
- Pre-INSERT, look up by `(user, commit_hash)` — if any EXECUTING/EXECUTED/PARTIALLY_FAILED/FAILED rows exist, surface 409 with the existing row status. This catches the "crash after INSERT, before DEL" retry path.

Crash recovery surface:
- Crash GET→INSERT: pending intact, no rows → next attempt finds nothing for the hash and proceeds normally.
- Crash INSERT→DEL: pending + EXECUTING rows both present → next attempt 409s, refusing to re-run brokers; operator / M3 reconciler resolves.
- Crash DEL→transition: pending gone, EXECUTING rows present → M3 reconciler picks them up by stale `updated_at` and queries the broker for ground truth.

Tests: 195 unified-trading cases green (was 186; +9 new in commit `4fccae4`):
- flag-on uses `GET` (NOT `GETDEL`)
- ordering invariant via call-order tracker: `recordExecuting` → `del-pending` → `transitionFromExecuting`
- 409 on prior EXECUTING row for same `(user, commit_hash)`
- per-`(user, hash)` check ignores rows from OTHER users with the same hash
- (existing terminal-status idempotency rejection retained)

14 order-ledger cases (was 9; +5 covering recordExecuting / transitionFromExecuting / transitionAll incl. length-mismatch invariant). 7 trading-flow integration cases unchanged (flag-off baseline).

**Known gaps / NOT shipped (M3 + M4):**
- M3 reconciler not yet built. Stuck EXECUTING rows would persist indefinitely until M3 lands. Acceptable while flag is off.
- Hydration of cached `ExecuteResult` from ledger rows on Redis cache-miss: still 400s on retry, mirroring the legacy `commitHistory`-hash-check 400. M3 territory.
- Reading paths (history endpoints, audit trails) still consult `wallet.commitHistory`. M4 swaps them.
