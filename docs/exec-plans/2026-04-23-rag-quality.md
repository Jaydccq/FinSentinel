# Exec Plan: RAG Quality (P1 slice)

> **For agentic workers:** REQUIRED SUB-SKILL — superpowers:executing-plans.

**Source PRD:** `docs/product-specs/2026-04-23-rag-fusion-prefilter-shadow-runner.md`
**Branch:** `feat/2026-04-23-rag-quality`
**Goal:** Three discrete quality wins on the RAG retrieval path: (a) weighted RRF that finally consumes `QueryVariant.weight`; (b) metadata pre-filter passes top-confidence sector / region into the existing `softFilter` channel (boost, no exclusion); (c) shadow runner uses a real semaphore instead of a 5 ms polling loop.
**Approach:** keep the existing call sites unchanged where possible; introduce additive method overloads / fields so default callers don't have to change.

## Out of scope (per codex consult 2026-04-23)

- HARD `strict_metadata=true` SQL pushdown for sector/region — defer until eval data backs the precision/recall trade.
- New SQL columns / migrations.
- Reranker tuning / new dense model.

## File Map

| Path                                                             | Role                                                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/rag/retrieval-fusion.service.ts`                   | MODIFY — overload `fuse()` to accept `WeightedLane[]` (keep existing array signature backwards-compatible).                                                  |
| `apps/api/src/rag/__tests__/retrieval-fusion.service.spec.ts`    | MODIFY — add weighted-RRF cases.                                                                                                                             |
| `apps/api/src/rag/metadata-pre-filter.service.ts`                | MODIFY — populate `softFilter.sector` + `softFilter.regionId` from `extracted.sectors` / `.regions` (top-1 by confidence); replace stale "discards" comment. |
| `apps/api/src/rag/sparse-search.service.ts`                      | MODIFY — extend the `softFilter` shape to include optional sector + regionId.                                                                                |
| `apps/api/src/rag/__tests__/metadata-pre-filter.service.spec.ts` | MODIFY — add cases for sector/region soft pushdown.                                                                                                          |
| `apps/api/src/rag/shadow-runner.service.ts`                      | MODIFY — replace polling `waitForSlot` with semaphore.                                                                                                       |
| `apps/api/src/rag/__tests__/shadow-runner.service.spec.ts`       | NEW or MODIFY — assert no `setTimeout(5)` polling; deterministic acquire/release.                                                                            |

## Tasks

### Task 1: Weighted RRF

- [ ] Add a `WeightedLane` type in `retrieval-fusion.service.ts`:

```ts
export interface WeightedLane {
  candidates: RankedCandidate[];
  /** Weight applied to each candidate's RRF contribution. Default 1. */
  weight?: number;
}
```

- [ ] Refactor `fuse()` to internally always operate on `WeightedLane[]`, but keep the public signature accepting either `RankedCandidate[][]` or `WeightedLane[]`:

```ts
fuse(
  lanes: RankedCandidate[][] | WeightedLane[],
  k = 60,
): FusedCandidate[] {
  const weighted: WeightedLane[] = lanes.map((lane) =>
    Array.isArray(lane) ? { candidates: lane, weight: 1 } : lane,
  );
  // existing loop, multiplying rrfContribution by `lane.weight ?? 1`
}
```

- [ ] Add tests:
  - same input as existing `merges two lanes via RRF` test, but pass `weight: 0` for one lane → its candidates contribute nothing.
  - pass `weight: 2` → contribution scales by 2× per rank.
- [ ] Existing tests remain green (backwards-compat input).
- [ ] Commit: `feat(rag): weighted RRF fusion (consumes QueryVariant.weight)`.

### Task 2: Metadata pre-filter sector/region soft pushdown

- [ ] Extend `SparseSearchFilters.softFilter` (in `sparse-search.service.ts`) to include `sector?: string` and `regionId?: string` (matching the hard fields).
- [ ] In `metadata-pre-filter.service.ts`:
  - delete the stale "currently discards" NOTE comment block.
  - after the lowTickers/lowIssuers gather, also pick the top-confidence sector and region from `extracted.sectors` / `extracted.regions` and add to `softFilter`. Use the same `hardMinConfidence` threshold to decide bucket — high-conf goes nowhere yet (deferred), low-conf or any-match goes to soft.
  - actually for V1: take the single highest-confidence sector and region (regardless of threshold) as soft hints. Keeps the change additive.
- [ ] Add tests:
  - `extracted.sectors = [{value:'Technology', confidence: 0.9}, {value:'Healthcare', confidence: 0.4}]` → `softFilter.sector === 'Technology'`.
  - `extracted.regions = [{value:'US', confidence: 0.7}]` → `softFilter.regionId === 'US'`.
  - `extracted.sectors = []` → no `sector` key in softFilter.
- [ ] Commit: `feat(rag): metadata pre-filter softpushes sector + regionId`.

### Task 3: Shadow runner semaphore

- [ ] Add a small `Semaphore` helper to `shadow-runner.service.ts`:

```ts
class Semaphore {
  private waiters: Array<() => void> = [];
  constructor(private slots: number) {}
  async acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.slots++;
  }
}
```

- [ ] Replace the field `private inflight = 0` with `private readonly slots: Semaphore` constructed from `config.concurrency`. Update `enqueue()` so it `acquire()`s before running the task and `release()`s in `finally`. Drop the `waitForSlot()` polling helper. The backpressure check (`queued + inflight ≥ concurrency + maxQueueDepth`) becomes `(this.waiters + active) ≥ ...`, where `waiters` and `active` are tracked counters owned by the runner.
- [ ] Add tests:
  - 4 tasks scheduled concurrently with `concurrency: 2`: at most 2 run at once, all complete deterministically (no sleep needed).
  - dropping/timeout/error semantics unchanged.
- [ ] Commit: `feat(rag): semaphore-based shadow runner (no 5ms polling)`.

### Task 4: full verify + progress log

- [ ] `pnpm --filter @finsentinel/api typecheck && pnpm --filter @finsentinel/api vitest run -- rag`.
- [ ] Append progress log to PRD.
- [ ] Whitelist exec plan in `.gitignore`.
- [ ] Commit progress log.

## Self-Review

- Spec coverage: §5.1 weighted RRF → Task 1. §5.2 sector/region (SOFT default per codex) → Task 2. §5.3 semaphore → Task 3. HARD pushdown explicitly out-of-scope per the plan header.
- Backwards compat: `fuse(RankedCandidate[][])` still works; `softFilter` extension is purely additive.
- Verification: each task ends in tests + commit.

## Risks

- The metadata-pre-filter service has a thick existing test suite; some assertions may need new fields tolerated. Add only, don't modify, where possible.
- Semaphore replaces a polling loop, but the queue-depth bookkeeping needs careful counter management — tests must cover both `dropped_backpressure` (high load) and the normal acquire path.
