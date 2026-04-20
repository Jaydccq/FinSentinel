# R7 — Shadow → Canary → Default Rollout of Multi-Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove multi-stage retrieval on live traffic before flipping the default, then flip the default, then (after 30 clean days) retire the single-stage code path.

**Architecture:** A new `RAG_ROLLOUT_MODE` knob with four states (`off | shadow | canary | on`). In `shadow`, single-stage serves the user while multi-stage runs fire-and-forget through a dedicated BullMQ worker / `p-queue` with its own DB pool and a queue-depth cap, persisting per-request comparisons into a new `rag_shadow_comparisons` table. An offline Python analyser computes per-class overlap/latency deltas. In `canary`, `RolloutGateService` decides per-request which pipeline to use based on `query_class` + a stickiness key that degrades gracefully from userId → sessionId → IP → request-id. Capstone: flip `RAG_MULTI_STAGE_ENABLED` default to true with correct env-var semantics, and schedule single-stage retirement after 30 clean days.

**Tech Stack:** Drizzle migration (V18), NestJS, BullMQ or `p-queue`, Prometheus, Postgres read-only pool, Python (offline analyser).

**Master plan reference:** `docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md:730-855`.

**Prerequisites:** R2, R3, and ideally R4/R6 must be shipped and passing the eval gate. R1.1 human-labelled golden set is strongly recommended before ramping past shadow.

---

## File Structure

- **Create** `packages/db/migrations/V18__add_rag_rollout_comparisons.sql`.
- **Create** `packages/db/src/schema/rag-shadow-comparisons.ts`.
- **Modify** `packages/db/src/schema/index.ts` — export new schema.
- **Modify** `apps/api/src/rag/rag-retrieval.service.ts` — shadow mode, canary routing, correct env-var semantics.
- **Modify** `apps/api/src/rag/rag-trace.service.ts` — persist shadow comparison row.
- **Create** `apps/api/src/rag/rollout-gate.service.ts`.
- **Create** `apps/api/src/rag/shadow-runner.service.ts` — queue-backed fire-and-forget runner with its own DB pool.
- **Modify** `apps/api/src/rag/rag.module.ts` — register new providers.
- **Modify** `apps/api/src/config/rag.config.ts` — new env vars.
- **Create** `services/evaluation-runner/analyse_shadow.py`.
- **Modify** `docs/runbooks/2026-04-19-rag-wave2-rollout.md` — document the ramp schedule, kill switches, and the 30-day retirement window.
- **Test** `apps/api/src/rag/__tests__/rollout-gate.service.spec.ts`.
- **Test** `apps/api/src/rag/__tests__/shadow-runner.service.spec.ts`.
- **Test** `apps/api/src/rag/__tests__/rag-retrieval.service.shadow.spec.ts` — integration-style, uses stubbed pipelines.

---

## Task R7.0: Migration V18 for `rag_shadow_comparisons`

**Files:**
- Create: `packages/db/migrations/V18__add_rag_rollout_comparisons.sql`.
- Create: `packages/db/src/schema/rag-shadow-comparisons.ts`.
- Modify: `packages/db/src/schema/index.ts`.

- [ ] **Step 1: Write the SQL migration**

```sql
-- packages/db/migrations/V18__add_rag_rollout_comparisons.sql
CREATE TABLE IF NOT EXISTS rag_shadow_comparisons (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash                text NOT NULL,
  query_class               text NOT NULL,
  single_stage_chunk_ids    text[] NOT NULL DEFAULT '{}',
  multi_stage_chunk_ids     text[] NOT NULL DEFAULT '{}',
  single_stage_latency_ms   integer,
  multi_stage_latency_ms    integer,
  shadow_timed_out          boolean NOT NULL DEFAULT false,
  shadow_dropped_backpressure boolean NOT NULL DEFAULT false,
  multi_stage_error         text,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_shadow_comparisons_created_at ON rag_shadow_comparisons (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_shadow_comparisons_query_class ON rag_shadow_comparisons (query_class, created_at DESC);

INSERT INTO schema_versions (version, description) VALUES ('V18', 'add rag_shadow_comparisons for R7 rollout');
```

- [ ] **Step 2: Write the Drizzle schema**

```ts
// packages/db/src/schema/rag-shadow-comparisons.ts
import { pgTable, uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const ragShadowComparisons = pgTable('rag_shadow_comparisons', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  queryHash: text('query_hash').notNull(),
  queryClass: text('query_class').notNull(),
  singleStageChunkIds: text('single_stage_chunk_ids').array().notNull().default(sql`ARRAY[]::text[]`),
  multiStageChunkIds: text('multi_stage_chunk_ids').array().notNull().default(sql`ARRAY[]::text[]`),
  singleStageLatencyMs: integer('single_stage_latency_ms'),
  multiStageLatencyMs: integer('multi_stage_latency_ms'),
  shadowTimedOut: boolean('shadow_timed_out').notNull().default(false),
  shadowDroppedBackpressure: boolean('shadow_dropped_backpressure').notNull().default(false),
  multiStageError: text('multi_stage_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Export from `packages/db/src/schema/index.ts`.

- [ ] **Step 3: Apply migration locally + typecheck**

Run these in parallel:
- `pnpm --filter @finsentinel/db db:migrate`
- `pnpm --filter @finsentinel/db typecheck`

Expected: migration applies cleanly, schema_versions has V18, typecheck green.

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/V18__add_rag_rollout_comparisons.sql packages/db/src/schema/rag-shadow-comparisons.ts packages/db/src/schema/index.ts
git commit -m "feat(db): V18 migration for rag_shadow_comparisons (R7.0)"
```

---

## Task R7.1a: RolloutGateService — failing tests

**Files:**
- Create: `apps/api/src/rag/__tests__/rollout-gate.service.spec.ts`.

- [ ] **Step 1: Write failing tests**

```ts
// apps/api/src/rag/__tests__/rollout-gate.service.spec.ts
import { RolloutGateService } from '../rollout-gate.service';

describe('RolloutGateService.decide', () => {
  const config = {
    percentByClass: { exact_lookup: 100, colloquial: 10, analytical: 10, multi_part: 10, relational: 10, factoid: 10 },
    anonMultiplier: 0.5,
  };

  it('always returns multi_stage for exact_lookup at 100%', () => {
    const gate = new RolloutGateService(config);
    for (let i = 0; i < 20; i++) {
      const { pipeline } = gate.decide('exact_lookup', { userId: `u${i}` });
      expect(pipeline).toBe('multi_stage');
    }
  });

  it('is deterministic per stickiness key (same user => same pipeline across calls)', () => {
    const gate = new RolloutGateService(config);
    const a1 = gate.decide('colloquial', { userId: 'fixed-user' }).pipeline;
    const a2 = gate.decide('colloquial', { userId: 'fixed-user' }).pipeline;
    expect(a1).toBe(a2);
  });

  it('lowers anon canary percent via the multiplier', () => {
    const gate = new RolloutGateService({ ...config, percentByClass: { ...config.percentByClass, colloquial: 40 } });
    let multiCount = 0, total = 10_000;
    for (let i = 0; i < total; i++) {
      if (gate.decide('colloquial', { ipAddress: `10.0.${i >> 8}.${i & 0xff}` }).pipeline === 'multi_stage') multiCount++;
    }
    // expected ~20% = 40 * 0.5, allow wide tolerance
    expect(multiCount / total).toBeGreaterThan(0.15);
    expect(multiCount / total).toBeLessThan(0.25);
  });

  it('falls through to request-id when no stickiness key available', () => {
    const gate = new RolloutGateService(config);
    const result = gate.decide('analytical', { requestId: 'req-1' });
    expect(result.stickinessSource).toBe('request_id');
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @finsentinel/api test -- rollout-gate`
Expected: FAIL — service missing.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/rag/__tests__/rollout-gate.service.spec.ts
git commit -m "test(rag): failing tests for RolloutGateService"
```

---

## Task R7.1b: RolloutGateService implementation

**Files:**
- Create: `apps/api/src/rag/rollout-gate.service.ts`.

- [ ] **Step 1: Implement**

```ts
// apps/api/src/rag/rollout-gate.service.ts
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { QueryClass } from './retrieval-planner.service';

export interface RolloutGateConfig {
  percentByClass: Partial<Record<QueryClass, number>>;
  anonMultiplier: number;
}

export interface StickinessInput {
  userId?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
}

export type StickinessSource = 'user_id' | 'session_id' | 'ip' | 'request_id';

export interface RolloutDecision {
  pipeline: 'multi_stage' | 'single_stage';
  stickinessSource: StickinessSource;
  auth: 'user' | 'anon';
  effectivePercent: number;
}

@Injectable()
export class RolloutGateService {
  constructor(private readonly config: RolloutGateConfig) {}

  decide(queryClass: QueryClass, stickiness: StickinessInput): RolloutDecision {
    const hourFloor = Math.floor(Date.now() / (30 * 60 * 1000)); // 30-min buckets
    let stickinessKey: string;
    let source: StickinessSource;
    let auth: 'user' | 'anon' = 'anon';

    if (stickiness.userId) { stickinessKey = stickiness.userId; source = 'user_id'; auth = 'user'; }
    else if (stickiness.sessionId) { stickinessKey = stickiness.sessionId; source = 'session_id'; }
    else if (stickiness.ipAddress) { stickinessKey = stickiness.ipAddress; source = 'ip'; }
    else { stickinessKey = stickiness.requestId ?? String(Math.random()); source = 'request_id'; }

    const hash = createHash('sha256').update(`${stickinessKey}:${hourFloor}:${queryClass}`).digest();
    const bucket = (hash.readUInt32BE(0) % 10_000) / 100; // 0..99.99

    const basePercent = this.config.percentByClass[queryClass] ?? 0;
    const effectivePercent = auth === 'anon' ? basePercent * this.config.anonMultiplier : basePercent;
    const pipeline: 'multi_stage' | 'single_stage' = bucket < effectivePercent ? 'multi_stage' : 'single_stage';

    return { pipeline, stickinessSource: source, auth, effectivePercent };
  }
}
```

- [ ] **Step 2: Run + commit**

Run: `pnpm --filter @finsentinel/api test -- rollout-gate`
Expected: PASS 4/4.

```bash
git add apps/api/src/rag/rollout-gate.service.ts
git commit -m "feat(rag): RolloutGateService with sticky, anon-aware canary (R7.1)"
```

---

## Task R7.2a: ShadowRunnerService with dedicated pool + backpressure drop

**Files:**
- Create: `apps/api/src/rag/shadow-runner.service.ts`.
- Create: `apps/api/src/rag/__tests__/shadow-runner.service.spec.ts`.

- [ ] **Step 1: Failing tests**

```ts
describe('ShadowRunnerService', () => {
  it('drops shadow work when queue depth exceeds the cap', async () => {
    const runner = new ShadowRunnerService({ concurrency: 2, maxQueueDepth: 3, timeoutMs: 1000 });
    const slowTask = () => new Promise(r => setTimeout(r, 200));
    // Fire 10 items; after the first (concurrency+maxQueueDepth) = 5 are admitted,
    // the rest must be rejected with droppedBackpressure=true.
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => runner.enqueue(slowTask)));
    const dropped = outcomes.filter(o => o === 'dropped_backpressure').length;
    expect(dropped).toBeGreaterThan(0);
  });

  it('times out a task that exceeds timeoutMs and records "timeout"', async () => {
    const runner = new ShadowRunnerService({ concurrency: 2, maxQueueDepth: 100, timeoutMs: 50 });
    const neverEnding = () => new Promise(() => {});
    const outcome = await runner.enqueue(neverEnding);
    expect(outcome).toBe('timed_out');
  });

  it('returns "executed" for a task completing under timeout', async () => {
    const runner = new ShadowRunnerService({ concurrency: 2, maxQueueDepth: 100, timeoutMs: 1000 });
    const outcome = await runner.enqueue(() => Promise.resolve('ok'));
    expect(outcome).toBe('executed');
  });
});
```

- [ ] **Step 2: Implement**

```ts
// apps/api/src/rag/shadow-runner.service.ts
import { Injectable, Logger } from '@nestjs/common';

export interface ShadowRunnerConfig {
  concurrency: number;
  maxQueueDepth: number;
  timeoutMs: number;
}

export type ShadowOutcome = 'executed' | 'timed_out' | 'dropped_backpressure' | 'errored';

@Injectable()
export class ShadowRunnerService {
  private readonly logger = new Logger(ShadowRunnerService.name);
  private inflight = 0;
  private queued = 0;

  constructor(private readonly config: ShadowRunnerConfig) {}

  async enqueue<T>(task: () => Promise<T>): Promise<ShadowOutcome> {
    if (this.queued + this.inflight >= this.config.concurrency + this.config.maxQueueDepth) {
      return 'dropped_backpressure';
    }
    this.queued++;
    await this.waitForSlot();
    this.queued--;
    this.inflight++;
    try {
      const timer = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), this.config.timeoutMs));
      await Promise.race([task(), timer]);
      return 'executed';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return msg === 'timeout' ? 'timed_out' : 'errored';
    } finally {
      this.inflight--;
    }
  }

  private async waitForSlot(): Promise<void> {
    while (this.inflight >= this.config.concurrency) {
      await new Promise(r => setTimeout(r, 5));
    }
  }
}
```

- [ ] **Step 3: Test + commit**

Run: `pnpm --filter @finsentinel/api test -- shadow-runner`
Expected: PASS.

```bash
git add apps/api/src/rag/shadow-runner.service.ts apps/api/src/rag/__tests__/shadow-runner.service.spec.ts
git commit -m "feat(rag): ShadowRunnerService with concurrency cap + timeout (R7.2)"
```

---

## Task R7.3: Wire shadow mode into `RagRetrievalService.search`

**Files:**
- Modify: `apps/api/src/rag/rag-retrieval.service.ts` — shadow branch + canary branch.
- Modify: `apps/api/src/rag/rag-trace.service.ts` — persist row to `rag_shadow_comparisons`.
- Test: `apps/api/src/rag/__tests__/rag-retrieval.service.shadow.spec.ts` — integration with stubs.

- [ ] **Step 1: Failing shadow test**

```ts
describe('RagRetrievalService shadow mode', () => {
  it('returns single-stage result even when multi-stage throws', async () => {
    // Stub single-stage to return [chunkA]; stub multi-stage to throw.
    // Assert: caller sees [chunkA]; no 5xx.
    // Assert: a row was persisted with multi_stage_error != null.
  });

  it('records shadow_timed_out when multi-stage exceeds shadow timeout', async () => {
    // Stub multi-stage to never resolve, shadow timeout 50ms.
    // Assert: row persisted with shadow_timed_out=true, multi_stage_error='timeout'.
    // Caller sees single-stage result.
  });

  it('increments rag_shadow_dropped_total when queue depth exceeds cap', async () => {
    // Fire N concurrent requests where N > concurrency + maxDepth.
    // Assert: metric increments; corresponding rows have shadow_dropped_backpressure=true.
  });
});
```

- [ ] **Step 2: Implement**

In `rag-retrieval.service.ts`, extend the constructor to accept `ShadowRunnerService`, `RolloutGateService`, and the config section. Add a private helper:

```ts
private async runShadow(params: { query: string; queryClass: QueryClass; singleResult: RagSearchResult[]; singleLatencyMs: number }): Promise<void> {
  if (this.config.rolloutMode !== 'shadow') return;
  if (Math.random() > this.config.shadowSampleRate) return;

  const shadowTask = async () => {
    const startedAt = Date.now();
    let multiIds: string[] = [];
    let multiError: string | null = null;
    try {
      const multi = await this.runMultiStageInternal(params.query);
      multiIds = multi.map(c => c.chunkId);
    } catch (err) {
      multiError = err instanceof Error ? err.message : String(err);
    }
    const multiLatencyMs = Date.now() - startedAt;
    await this.ragTrace.persistShadowComparison({
      queryHash: createHash('sha256').update(params.query).digest('hex'),
      queryClass: params.queryClass,
      singleStageChunkIds: params.singleResult.map(r => r.chunkId),
      multiStageChunkIds: multiIds,
      singleStageLatencyMs: params.singleLatencyMs,
      multiStageLatencyMs: multiError ? null : multiLatencyMs,
      shadowTimedOut: multiError === 'timeout',
      shadowDroppedBackpressure: false,
      multiStageError: multiError,
    });
  };

  const outcome = await this.shadowRunner.enqueue(shadowTask);
  this.metrics.incrementCounter('rag_shadow_outcome_total', 'Shadow runner outcome counts', { outcome });
  if (outcome === 'dropped_backpressure') {
    await this.ragTrace.persistShadowComparison({
      queryHash: createHash('sha256').update(params.query).digest('hex'),
      queryClass: params.queryClass,
      singleStageChunkIds: params.singleResult.map(r => r.chunkId),
      multiStageChunkIds: [],
      singleStageLatencyMs: params.singleLatencyMs,
      multiStageLatencyMs: null,
      shadowTimedOut: false,
      shadowDroppedBackpressure: true,
      multiStageError: 'dropped_backpressure',
    });
  }
}
```

In the `search()` entry point, after running whichever pipeline is primary, call `this.runShadow(...)` **without awaiting** (or with `void` prefix). The request must never block on the shadow.

Canary branch:

```ts
if (this.config.rolloutMode === 'canary') {
  const { pipeline } = this.rolloutGate.decide(queryClass, stickinessInput);
  this.metrics.incrementCounter('rag_retrieval_pipeline', 'Pipeline selection count', { mode: pipeline, class: queryClass });
  if (pipeline === 'multi_stage') return this.runMultiStage(...);
  return this.runSingleStage(...);
}
```

In `rag-trace.service.ts` add:

```ts
async persistShadowComparison(row: ShadowComparisonRow): Promise<void> {
  await this.db.insert(ragShadowComparisons).values({
    queryHash: row.queryHash,
    queryClass: row.queryClass,
    singleStageChunkIds: row.singleStageChunkIds,
    multiStageChunkIds: row.multiStageChunkIds,
    singleStageLatencyMs: row.singleStageLatencyMs,
    multiStageLatencyMs: row.multiStageLatencyMs,
    shadowTimedOut: row.shadowTimedOut,
    shadowDroppedBackpressure: row.shadowDroppedBackpressure,
    multiStageError: row.multiStageError,
  });
}
```

Note: the known postgres.js mixed-default INSERT bug (see CLAUDE.md) — specify every column explicitly even for nullable fields, matching the pattern in `analysis-checkpoint.service.ts:40-52`.

- [ ] **Step 3: Run**

Run these in parallel:
- `pnpm --filter @finsentinel/api typecheck`
- `pnpm --filter @finsentinel/api test -- rag-retrieval.service.shadow`
- `pnpm --filter @finsentinel/api test -- rag`

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/rag/rag-retrieval.service.ts apps/api/src/rag/rag-trace.service.ts apps/api/src/rag/__tests__/rag-retrieval.service.shadow.spec.ts
git commit -m "feat(rag): shadow + canary branches in RagRetrievalService (R7.3)"
```

---

## Task R7.4: Offline analyser (Python)

**Files:**
- Create: `services/evaluation-runner/analyse_shadow.py`.

- [ ] **Step 1: Implement**

```python
# services/evaluation-runner/analyse_shadow.py
"""Reads rag_shadow_comparisons and emits a per-query-class diff report."""
import argparse
import json
import os
import statistics
from collections import defaultdict

import psycopg


def overlap_at_k(a: list[str], b: list[str], k: int) -> float:
    if not a:
        return 0.0
    return len(set(a[:k]) & set(b[:k])) / min(len(a), k)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--db-url', default=os.environ.get('DATABASE_URL'))
    parser.add_argument('--since', default='now() - interval \'7 days\'')
    parser.add_argument('--out', default='reports/shadow-analysis.md')
    args = parser.parse_args()

    with psycopg.connect(args.db_url) as conn:
        rows = conn.execute(f'''
            SELECT query_class, single_stage_chunk_ids, multi_stage_chunk_ids,
                   single_stage_latency_ms, multi_stage_latency_ms,
                   shadow_timed_out, shadow_dropped_backpressure, multi_stage_error
            FROM rag_shadow_comparisons
            WHERE created_at >= {args.since}
        ''').fetchall()

    by_class = defaultdict(list)
    for r in rows:
        by_class[r[0]].append(r)

    lines = ['# Shadow Comparison Report\n']
    for cls, entries in sorted(by_class.items()):
        ok = [e for e in entries if not e[5] and not e[6] and not e[7]]
        overlaps_5 = [overlap_at_k(e[1], e[2], 5) for e in ok]
        overlaps_10 = [overlap_at_k(e[1], e[2], 10) for e in ok]
        lat_single = [e[3] for e in ok if e[3] is not None]
        lat_multi = [e[4] for e in ok if e[4] is not None]
        lines += [
            f'## {cls} (n={len(entries)}, successful={len(ok)})',
            f'- overlap@5 mean={statistics.mean(overlaps_5) if overlaps_5 else 0:.3f}',
            f'- overlap@10 mean={statistics.mean(overlaps_10) if overlaps_10 else 0:.3f}',
            f'- single-stage p50 latency={statistics.median(lat_single) if lat_single else 0:.1f}ms',
            f'- multi-stage  p50 latency={statistics.median(lat_multi) if lat_multi else 0:.1f}ms',
            f'- timed out: {sum(1 for e in entries if e[5])}  dropped: {sum(1 for e in entries if e[6])}  errored: {sum(1 for e in entries if e[7])}',
            '',
        ]

    with open(args.out, 'w') as f:
        f.write('\n'.join(lines))
    print(f'wrote {args.out}')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Smoke-test against local DB**

Run:
```bash
python services/evaluation-runner/analyse_shadow.py --db-url "$DATABASE_URL" --out reports/shadow-analysis.md
```

Expected: produces an empty or partial report file without errors.

- [ ] **Step 3: Commit**

```bash
git add services/evaluation-runner/analyse_shadow.py
git commit -m "feat(rag): offline shadow comparison analyser (R7.4)"
```

---

## Task R7.5: Config wiring for `RAG_ROLLOUT_MODE` and related knobs

**Files:**
- Modify: `apps/api/src/config/rag.config.ts`.
- Modify: `apps/api/src/rag/rag.module.ts` to register `ShadowRunnerService` + `RolloutGateService`.

- [ ] **Step 1: Append config**

```ts
// in rag.config.ts — append inside ragConfig export:
rollout: {
  mode: (process.env['RAG_ROLLOUT_MODE'] ?? 'off') as 'off' | 'shadow' | 'canary' | 'on',
  shadowSampleRate: Number(process.env['RAG_SHADOW_SAMPLE_RATE'] ?? '1.0'),
  shadowTimeoutMs: Number(process.env['RAG_SHADOW_TIMEOUT_MS']) || 2000,
  shadowConcurrency: Number(process.env['RAG_SHADOW_CONCURRENCY']) || 4,
  shadowDbPoolSize: Number(process.env['RAG_SHADOW_DB_POOL_SIZE']) || 4,
  shadowMaxQueueDepth: Number(process.env['RAG_SHADOW_MAX_QUEUE_DEPTH']) || 200,
  canaryPercentByClass: JSON.parse(
    process.env['RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS'] ??
    '{"exact_lookup":100,"colloquial":10,"analytical":10,"multi_part":10,"relational":10,"factoid":10}',
  ),
  anonMultiplier: Number(process.env['RAG_ROLLOUT_ANON_PERCENT_MULTIPLIER']) || 0.5,
},
```

- [ ] **Step 2: Register providers**

In `rag.module.ts`:

```ts
{
  provide: ShadowRunnerService,
  useFactory: (config: ConfigService) => new ShadowRunnerService({
    concurrency: config.get('rag.rollout.shadowConcurrency', 4),
    maxQueueDepth: config.get('rag.rollout.shadowMaxQueueDepth', 200),
    timeoutMs: config.get('rag.rollout.shadowTimeoutMs', 2000),
  }),
  inject: [ConfigService],
},
{
  provide: RolloutGateService,
  useFactory: (config: ConfigService) => new RolloutGateService({
    percentByClass: config.get('rag.rollout.canaryPercentByClass', {}),
    anonMultiplier: config.get('rag.rollout.anonMultiplier', 0.5),
  }),
  inject: [ConfigService],
},
```

- [ ] **Step 3: Run**

Run: `pnpm --filter @finsentinel/api typecheck && pnpm --filter @finsentinel/api test -- rag`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/config/rag.config.ts apps/api/src/rag/rag.module.ts
git commit -m "feat(rag): config wiring for rollout mode + runner + gate (R7.5)"
```

---

## Task R7.6: Runbook — ramp schedule, kill switches, 30-day retirement window

**Files:**
- Modify: `docs/runbooks/2026-04-19-rag-wave2-rollout.md`.

- [ ] **Step 1: Add the ramp schedule block**

Append:

```md
## R7 — Rollout ramp

| Step | Duration | Action | Rollback trigger |
|------|----------|--------|------------------|
| 1 | 7 days | `RAG_ROLLOUT_MODE=shadow` across all classes | shadow timeout rate >5%, `rag_shadow_dropped_total` rising |
| 2 | 3 days | `RAG_ROLLOUT_MODE=canary` with exact_lookup 100%, others 10% | error rate per pipeline regresses |
| 3 | 3 days | Canary: 50% across all classes | P95 latency +30% vs single-stage baseline |
| 4 | 3 days | Canary: 100% across all classes | eval gate regression |
| 5 | — | Flip default `RAG_MULTI_STAGE_ENABLED=true` (R7.7); single-stage code retires after **30 clean days** (R7.8). |

**Kill switches:**
- `RAG_ROLLOUT_MODE=off` — reverts to single-stage on every request regardless of other flags.
- `RAG_MULTI_STAGE_ENABLED=false` — forces single-stage even if the gate says multi-stage.
- Both are checked on each request; no redeploy needed.

**Dashboards:**
- `rag_retrieval_pipeline{mode,class,auth}` — traffic split.
- `rag_shadow_outcome_total{outcome}` — shadow runner behaviour.
- `rag_shadow_dropped_total{reason}` — backpressure signal.

**30-day retirement window:** the single-stage branch in `RagRetrievalService.search` MUST remain in place for 30 clean days after R7.7 flips the default. This covers at least one full weekly eval cycle and one on-call rotation. Earlier retirement is out of scope for Wave 2.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/2026-04-19-rag-wave2-rollout.md
git commit -m "docs(runbook): R7 ramp schedule, kill switches, 30-day retirement window"
```

---

## Task R7.7: Flip the default — correct env-var semantics

**Files:**
- Modify: `apps/api/src/config/rag.config.ts`.
- Modify: `apps/api/src/rag/rag-retrieval.service.ts:77` — replace direct `process.env` read.

Today (`rag-retrieval.service.ts:77`):

```ts
this.multiStageEnabled = configService.get<string>('RAG_MULTI_STAGE_ENABLED', 'false') === 'true';
```

This defaults to `false` and blocks the flip. Also, a `Boolean(process.env['X'])` anti-pattern would be wrong here — `Boolean('false')` is truthy because a non-empty string is truthy in JS.

- [ ] **Step 1: Write failing config test**

```ts
// apps/api/src/config/__tests__/rag.config.multi-stage.spec.ts
describe('rag.multiStageEnabled env-var semantics', () => {
  afterEach(() => { delete process.env['RAG_MULTI_STAGE_ENABLED']; });

  it('defaults to true when unset', () => {
    const cfg = require('../rag.config').ragConfig();
    expect(cfg.multiStageEnabled).toBe(true);
  });
  it('is true for empty string', () => {
    process.env['RAG_MULTI_STAGE_ENABLED'] = '';
    expect(require('../rag.config').ragConfig().multiStageEnabled).toBe(true);
  });
  it('is true for "true"', () => {
    process.env['RAG_MULTI_STAGE_ENABLED'] = 'true';
    expect(require('../rag.config').ragConfig().multiStageEnabled).toBe(true);
  });
  it('is false only for literal "false"', () => {
    process.env['RAG_MULTI_STAGE_ENABLED'] = 'false';
    expect(require('../rag.config').ragConfig().multiStageEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Update config**

```ts
// rag.config.ts — at the top level of the returned object
multiStageEnabled: process.env['RAG_MULTI_STAGE_ENABLED'] !== 'false',
```

Update `rag-retrieval.service.ts:77` to read from config:

```ts
this.multiStageEnabled = configService.get<boolean>('rag.multiStageEnabled', true) as boolean;
```

- [ ] **Step 3: Run**

Run these in parallel:
- `pnpm --filter @finsentinel/api typecheck`
- `pnpm --filter @finsentinel/api test -- rag.config`
- `pnpm --filter @finsentinel/api test -- rag`

Expected: green.

- [ ] **Step 4: Verify flag-off regression snapshot still matches**

Run: `pnpm --filter @finsentinel/api test -- flag-off-regression` (the T1.A snapshot introduced in Wave 2).
Expected: unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/rag.config.ts apps/api/src/rag/rag-retrieval.service.ts apps/api/src/config/__tests__/rag.config.multi-stage.spec.ts
git commit -m "feat(rag): flip RAG_MULTI_STAGE_ENABLED default to on; env-var semantics fixed (R7.7)"
```

---

## Task R7.8 (deferred, runbook-only): Single-stage retirement after 30 clean days

- [ ] **Step 1: Add retirement checklist to runbook**

Append to `docs/runbooks/2026-04-19-rag-wave2-rollout.md`:

```md
### R7.8 — Single-stage retirement checklist

Trigger: 30 consecutive clean days with `RAG_MULTI_STAGE_ENABLED` default on.
"Clean" means: no paging alert, no eval gate regression, no parser or reranker
sidecar incident that required falling back to single-stage. Keep
`compare_reports/*.json` baselines for at least 90 days for audit.

- [ ] Delete the single-stage branch in `RagRetrievalService.search`.
- [ ] Remove the legacy similarity-only `RagSearchResult` emission path.
- [ ] Remove the T1.A flag-off regression snapshot test.
- [ ] Retire `RAG_MULTI_STAGE_ENABLED` env var — file a follow-up to delete the knob from `rag.config.ts` a full release later.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/2026-04-19-rag-wave2-rollout.md
git commit -m "docs(runbook): R7.8 single-stage retirement checklist (30-day window)"
```

**R7.8 code changes are out of scope for the Wave 2 R7 phase.**

---

## Exit Criteria

- V18 migration applied; `rag_shadow_comparisons` exists with all columns including `multi_stage_error` and `shadow_dropped_backpressure`.
- `RolloutGateService` and `ShadowRunnerService` shipped with their TDD suites.
- Shadow branch runs multi-stage fire-and-forget under a dedicated concurrency + queue-depth cap and persists comparison rows (including dropped + timed-out).
- Offline analyser produces a per-class overlap + latency report from the DB.
- Canary branch routes per-request via sticky, anon-aware `RolloutGateService`.
- `RAG_MULTI_STAGE_ENABLED` default is `true`; only the literal string `"false"` disables it (R7.7).
- Runbook documents the ramp schedule, kill switches, 30-day retirement window, and R7.8 retirement checklist.
- Flag-off regression snapshot unchanged.
- Typecheck + rag suite green.

**Explicit non-exit-criterion:** R7.8 (code-level single-stage retirement) is NOT a Wave 2 deliverable — it is scheduled 30 clean days after R7.7 lands and tracked via the runbook checklist.

## Risks

- **Shadow backpressure under bursty traffic.** The `maxQueueDepth` cap protects the DB pool and reranker sidecar, but a misconfigured cap can drop the majority of shadow traffic and produce a skewed analyser report. Mitigation: the analyser reports timeout and dropped counts alongside overlap, so a skew is visible.
- **Sticky-key hash fairness.** If anon traffic overwhelms authenticated traffic, the `anonMultiplier=0.5` default may still under-sample multi-stage among power users. Monitor `rag_rollout_stickiness_source_total{source}` to judge.
- **30-day retention window pressure.** Stakeholders may push to retire single-stage sooner. The runbook makes the window explicit; escalate to the on-call rotation lead if asked to shorten.
- **Known postgres.js INSERT bug.** The `rag_shadow_comparisons` insert path must specify every column (per CLAUDE.md database gotcha). R7.3's implementation block flags this; reviewers should double-check the call site.
- **Config reload semantics.** `RAG_ROLLOUT_MODE` is read at boot. Changing ramp step requires a rolling deploy unless a future ticket adds a hot-reload path. Call this out in the runbook.
