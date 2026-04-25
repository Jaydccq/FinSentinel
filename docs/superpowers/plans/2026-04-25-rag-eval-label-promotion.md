# RAG Eval Label Promotion — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build a repeatable pipeline that promotes real query/answer pairs from `rag_query_logs` (and `chat_messages` where applicable) into the golden eval set, replacing or augmenting the synthetic 100-row dataset behind a feature flag. Until at least 50 rows are real-user-derived and bucket-balanced, the existing default eval thresholds in CI stay unchanged. Unblocks item 6 (RAG 2048-dim index/tier strategy) and item 9 (query-planner classifier) — both of which are currently blocked on labelled eval data per `docs/exec-plans/tech-debt-tracker.md`.

**Architecture:** A new CLI under `apps/api/src/rag/cli/` reads a window of `rag_query_logs`, samples by query class and corpus distribution, and writes promoted rows into `services/evaluation-runner/datasets/golden.json` with provenance fields. A reviewer step (manual, but supported by an exported summary) approves promoted rows. Promoted rows carry an explicit `provenance_label = 'real_user_promoted'`, distinguishing them from synthetic rows. The evaluation runner already accepts mixed provenance — this plan only adds the promotion path.

**Tech Stack:** NestJS 11 CLI module, Drizzle ORM, Vitest, Python evaluation runner (consume-only, no changes here).

---

## Background

Per `docs/exec-plans/2026-04-21-rag-quality-next-steps.md` follow-up #2 ("Provenance — PARTIALLY ADDRESSED"), 30 of 100 golden rows are natural-phrasing synthetic and 70 are reverse-engineered synthetic. True real-user promotion from `rag_query_logs` and `chat_messages` is required but the pipeline does not exist. Without it:
- Item 6 cannot pick between seq-scan / IVFFlat / halfvec / 1536+2048 tier on labelled signal.
- Item 9 cannot run shadow eval against rules-only routing.

This plan delivers the **first 50 rows** of real-user-promoted data. It does not promise perfect coverage; it delivers a tool that produces auditable promotions and proves the path end-to-end with a meaningful sample.

## Scope

**In:**
- New CLI: `pnpm --filter @finsentinel/api cli:rag:promote-eval` (or `apps/api/src/rag/cli/rag-promote-eval.cli.ts`).
- Sampling strategy: stratified by query class (`exact_lookup`, `factoid`, `relational`, `analytical`, `multi_part`) and time window.
- PII redaction step (drop user IDs, raw tokens, anything matching email / phone / API-key patterns).
- Output: appended JSON entries with `provenance_label = 'real_user_promoted'`, `source_query_log_id`, `promoted_at`, `redactions_applied`.
- A short markdown report `docs/runbooks/2026-04-25-rag-eval-promotion-runbook.md` describing operator steps.
- Vitest coverage for sampling, redaction, and write/append behavior.

**Out:**
- Re-running the full RAG quality eval against the new dataset (separate plan, gated on review).
- Adding a UI for human reviewer approval (CLI prints a diff; reviewer edits JSON manually for now).
- Promotion of `chat_messages` queries (queue for phase 2 — they need richer context to label correctly).
- Any change to retrieval / ranking logic.

## Assumptions

- `rag_query_logs` table exists and contains `id`, `query_text`, `query_class`, `top_chunk_ids`, `created_at`, `user_id`. Subagent must verify against `packages/db/src/schema/`. If the table or columns differ, subagent maps to the actual fields and notes the mapping in the runbook.
- `services/evaluation-runner/datasets/golden.json` is the live golden set and accepts new rows in the same JSON-array shape.
- Synthetic rows already have a stable schema: `{ id, query, expected_chunk_ids, query_class, provenance_label, ... }`. Subagent reads one existing row to mirror the shape.

## File Structure

```
apps/api/src/rag/cli/
  rag-promote-eval.cli.ts                  (new — CLI entry)
  rag-promote-eval.module.ts               (new — Nest module)
  rag-promote-eval.service.ts              (new — sampling + redaction + write)
  __tests__/
    rag-promote-eval.service.spec.ts       (new)
docs/runbooks/
  2026-04-25-rag-eval-promotion-runbook.md (new)
services/evaluation-runner/datasets/
  golden.json                              (modify — append promoted rows)
  golden.meta.json                         (modify — bump version, add promotion summary)
```

---

## Task 1: Service skeleton + sampling

**Files:**
- Create: `apps/api/src/rag/cli/rag-promote-eval.service.ts`
- Create: `apps/api/src/rag/cli/__tests__/rag-promote-eval.service.spec.ts`

- [ ] **Step 1: Failing test for stratified sampling**

```ts
import { describe, it, expect } from 'vitest';
import { stratifiedSample } from '../rag-promote-eval.service';

describe('stratifiedSample', () => {
  it('returns balanced rows across query classes', () => {
    const logs = [
      ...Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, query_class: 'factoid' })),
      ...Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, query_class: 'exact_lookup' })),
      ...Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, query_class: 'analytical' })),
    ];
    const out = stratifiedSample(logs, { perClass: 5 });
    const counts = out.reduce<Record<string, number>>((acc, r) => {
      acc[r.query_class] = (acc[r.query_class] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.factoid).toBe(5);
    expect(counts.exact_lookup).toBe(5);
    expect(counts.analytical).toBe(5);
  });

  it('caps to available rows when a class is short', () => {
    const logs = [
      { id: 'f1', query_class: 'factoid' },
      { id: 'f2', query_class: 'factoid' },
    ];
    expect(stratifiedSample(logs, { perClass: 5 })).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Confirm failure.**
- [ ] **Step 3: Implement minimal sampler:**

```ts
export interface QueryLogRow {
  id: string;
  query_text?: string;
  query_class: string;
  top_chunk_ids?: string[];
  user_id?: string;
  created_at?: string;
}

export interface SampleOptions {
  perClass: number;
  seed?: number;
}

export function stratifiedSample(rows: QueryLogRow[], opts: SampleOptions): QueryLogRow[] {
  const buckets = new Map<string, QueryLogRow[]>();
  for (const r of rows) {
    const arr = buckets.get(r.query_class) ?? [];
    arr.push(r);
    buckets.set(r.query_class, arr);
  }
  const out: QueryLogRow[] = [];
  for (const [, arr] of buckets) {
    out.push(...arr.slice(0, opts.perClass));
  }
  return out;
}
```

- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit.

```bash
git commit -m "feat(rag): add stratified sampler for query-log promotion"
```

---

## Task 2: PII redaction

- [ ] **Step 1: Failing test**

```ts
import { redactPii } from '../rag-promote-eval.service';

it('drops user IDs and high-entropy tokens', () => {
  const out = redactPii('What does sk-abcdef1234567890abcdef1234567890 do?');
  expect(out).not.toContain('sk-');
});

it('replaces email-like tokens', () => {
  expect(redactPii('email me at jane@example.com')).toMatch(/\[redacted-email\]/);
});

it('passes through ordinary text', () => {
  expect(redactPii('show AAPL 10-K filings')).toBe('show AAPL 10-K filings');
});
```

- [ ] **Step 2: Confirm failure.**

- [ ] **Step 3: Implement**

```ts
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const APIKEY = /\b(sk|pk|ghp|nvapi)[-_][A-Z0-9]{16,}/gi;
const PHONE = /\b\+?\d[\d\s().-]{7,}\d\b/g;

export function redactPii(text: string): string {
  return text
    .replace(EMAIL, '[redacted-email]')
    .replace(APIKEY, '[redacted-token]')
    .replace(PHONE, '[redacted-phone]');
}
```

- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit.

```bash
git commit -m "feat(rag): add PII redaction for promoted query logs"
```

---

## Task 3: Promotion writer

- [ ] **Step 1: Failing test that promoted rows match golden schema**

```ts
import { buildPromotedRow } from '../rag-promote-eval.service';

it('produces a row that mirrors the golden-set shape with promoted provenance', () => {
  const row = buildPromotedRow(
    {
      id: 'log-1',
      query_text: 'AAPL 10-K FY2024 revenue',
      query_class: 'exact_lookup',
      top_chunk_ids: ['c1', 'c2', 'c3'],
      created_at: '2026-04-20T00:00:00Z',
    },
    { promotedAt: '2026-04-25T00:00:00Z' },
  );
  expect(row.provenance_label).toBe('real_user_promoted');
  expect(row.source_query_log_id).toBe('log-1');
  expect(row.expected_chunk_ids).toEqual(['c1', 'c2', 'c3']);
  expect(row.query).toBe('AAPL 10-K FY2024 revenue');
  expect(row.query_class).toBe('exact_lookup');
});
```

- [ ] **Step 2: Confirm failure.**

- [ ] **Step 3: Implement.** Subagent reads one existing row from `services/evaluation-runner/datasets/golden.json` to confirm the exact field names. Implement `buildPromotedRow`:

```ts
export function buildPromotedRow(
  log: QueryLogRow,
  ctx: { promotedAt: string },
): PromotedRow {
  return {
    id: `promoted-${log.id}`,
    query: redactPii(log.query_text ?? ''),
    query_class: log.query_class,
    expected_chunk_ids: log.top_chunk_ids ?? [],
    provenance_label: 'real_user_promoted',
    source_query_log_id: log.id,
    promoted_at: ctx.promotedAt,
  };
}
```

- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit.

```bash
git commit -m "feat(rag): build promoted golden-set row from query log"
```

---

## Task 4: CLI module + dry-run mode

**Files:**
- Create: `apps/api/src/rag/cli/rag-promote-eval.module.ts`
- Create: `apps/api/src/rag/cli/rag-promote-eval.cli.ts`

- [ ] **Step 1:** Subagent reads `apps/api/src/rag/cli/` for existing CLI patterns (e.g. `rag-backfill-representation-sparse.cli.ts`) and mirrors the bootstrap module shape.

- [ ] **Step 2:** Implement a CLI that:
  - Accepts `--per-class <N>` (default 10), `--since <ISO>` (default now-30d), `--out <path>` (default `services/evaluation-runner/datasets/golden.json`), `--dry-run` (default false).
  - Queries `rag_query_logs` via Drizzle.
  - Runs `stratifiedSample` then `buildPromotedRow` for each.
  - In `--dry-run`, prints a JSON summary `{ classes: { exact_lookup: 5, … }, total: N }` and exits.
  - Otherwise reads existing golden.json, appends new rows (skipping any whose `source_query_log_id` already exists), writes back, and updates `golden.meta.json` (`version`, `promoted_at`, `promoted_count`).

- [ ] **Step 3:** Add an integration test that runs the CLI against an in-memory sample (no DB hit).

- [ ] **Step 4:** Run, expect PASS.
- [ ] **Step 5:** Commit.

```bash
git commit -m "feat(rag): add rag:promote-eval CLI with dry-run and idempotent append"
```

---

## Task 5: Runbook

**Files:**
- Create: `docs/runbooks/2026-04-25-rag-eval-promotion-runbook.md`

Document:
- Prerequisite: `rag_query_logs` populated for the target window.
- Dry-run command + how to read the summary.
- Live promotion command + expected diff in `golden.json`.
- Reviewer checklist before committing the dataset change (PII spot-check, query class balance, no duplicate `source_query_log_id`).
- Rollback: `git revert` the dataset commit; `golden.meta.json` version bump makes the rollback obvious in CI.

- [ ] **Step 1:** Write the file.
- [ ] **Step 2:** Commit.

```bash
git commit -m "docs(rag): add runbook for promoting real query logs into eval golden set"
```

---

## Task 6: One-shot promotion of a sample window

This task **only runs against staging or local data the operator has access to**. The subagent does **not** need to actually run the CLI against production — the deliverable is the tooling and a dry-run output captured in the runbook.

- [ ] **Step 1:** Run `pnpm --filter @finsentinel/api cli:rag:promote-eval -- --dry-run --per-class 10 --since 2026-04-01T00:00:00Z` (subagent best-effort; if the local DB has no logs, mark the runbook section "captured locally" with empty-class counts and proceed).

- [ ] **Step 2:** Paste the dry-run output into the runbook so the next operator has a reference shape.

- [ ] **Step 3:** Commit (if any change to runbook).

```bash
git commit -m "docs(rag): capture dry-run sample output in promotion runbook"
```

---

## Task 7: Verification + tracker update

- [ ] **Step 1:** Run `pnpm --filter @finsentinel/api typecheck` and `pnpm --filter @finsentinel/api test` covering the new specs. Both PASS.

- [ ] **Step 2:** Update `docs/exec-plans/tech-debt-tracker.md`:
  - Under "Cloud RAG quality work is blocked by synthetic/offline evaluation and stub parsing", add a sub-bullet noting the promotion CLI exists and that real promotion can begin as soon as `rag_query_logs` carries enough representative traffic.
  - Under "Query-planner classifier is blocked on labelled RAG eval data", add a pointer to the runbook so the next item-9 attempt has a clear unblock path.

- [ ] **Step 3:** Push branch + open PR.

```bash
git push -u origin feat/2026-04-25-rag-eval-promotion
gh pr create --title "feat(rag): query-log → golden-set promotion CLI + runbook" \
  --body "Implements docs/superpowers/plans/2026-04-25-rag-eval-label-promotion.md. Unblocks item 6 (2048-dim tier strategy) and item 9 (query planner classifier) by giving operators a tested path to grow real-user-labelled eval rows."
```

## Verification Approach

1. Unit tests pin the sampler, redaction, and row-build behavior.
2. CLI integration test runs the full pipeline against in-memory rows (no DB).
3. Runbook captures the operator path so the next promotion run is reproducible.
4. Tech-debt tracker entries point future readers to the unblock path.

## Risks

- **Incorrect labels.** Real query logs contain the *retrieved* top chunks, not the *correct* top chunks. Promoted rows are a "what the system chose" baseline, not ground truth. Operator must re-label before using these for hard-quality evaluation. The runbook calls this out explicitly.
- **PII slippage.** Regex-based redaction misses many shapes. The runbook requires a manual PII spot-check before committing.
- **Dataset version churn.** Bump `golden.meta.json.version` on every promotion so CI gates can pin against a known revision.

## Progress Log

(Subagent fills in.)

## Final Outcome

(Filled after merge.)
