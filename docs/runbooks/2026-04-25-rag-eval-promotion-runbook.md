# RAG Eval Label Promotion Runbook

**Date:** 2026-04-25
**Owner:** RAG quality workstream (item 6 in `docs/exec-plans/tech-debt-tracker.md`).
**Plan:** `docs/superpowers/plans/2026-04-25-rag-eval-label-promotion.md`.
**Tooling:** `pnpm --filter @finsentinel/api rag:eval:promote` (source:
`apps/api/src/rag/eval/rag-promote-eval.cli.ts`).

This runbook describes how an operator promotes real `rag_query_logs` rows
into `services/evaluation-runner/datasets/golden.json`. Phase 1 ships the
*tooling* only — no real promoted rows are committed to the dataset yet.

---

## Prerequisites

1. **`rag_query_logs` populated for the target window.**
   `RagTraceService` writes per-query rows to `rag_query_logs` (partitioned
   by month — see `packages/db/migrations/V17__add_rag_query_logs.sql`).
   Confirm the staging or local DB you point `DATABASE_URL` at actually
   has rows in the window by running:

   ```sql
   SELECT count(*), date_trunc('day', created_at) AS day
     FROM rag_query_logs
    WHERE created_at >= '2026-04-01'
    GROUP BY day
    ORDER BY day DESC;
   ```

2. **`rag.queryLog.piiEnabled = true` for the window.**
   `query_preview` (the redacted query text we promote into the golden set
   `query` field) is `NULL` unless `rag.queryLog.piiEnabled` is set when
   the trace is recorded. Without it, every row in the window is unusable.
   The CLI will print:

   ```
   [promote-eval] all <N> rows have NULL query_preview. Set
   rag.queryLog.piiEnabled=true in the staging window before promoting,
   then re-run.
   ```

   See `apps/api/src/rag/rag-trace.service.ts` for how the flag controls
   the preview.

3. **`DATABASE_URL` points at a writable DB you have read access to.**
   The CLI reads from `rag_query_logs` and writes the golden file to disk.
   It does *not* write back to the DB.

---

## Step 1: Dry-run

Always dry-run first. It prints a class-balance summary so you can sanity-check
sample distribution before committing dataset changes.

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/finsentinel \
  pnpm --filter @finsentinel/api rag:eval:promote -- \
  --dry-run --per-class 10 --since 2026-04-01T00:00:00Z
```

Expected output (shape — actual numbers vary):

```
[promote-eval] per_class=10 since=2026-04-01T00:00:00Z out=.../golden.json dry_run=true
[promote-eval][dry-run] sampled=N classes={"factoid":N1,"exact_lookup":N2,...} without_preview=M

rag:eval:promote
----------------
Total sampled        : N
Class balance        : {"factoid":N1,"exact_lookup":N2,...}
Added                : 0
Skipped (duplicates) : 0
Rows without preview : M
[dry-run] No writes were issued. Drop --dry-run to promote.
```

What to look for in the summary:
- **Total sampled** — should be > 0. If 0, either no traffic in the window
  (warning emitted) or the partitions were dropped by the retention job.
- **Class balance** — at least 3+ buckets should be non-empty for a useful
  promotion. If only one bucket has data, expand `--since` or pick a
  different window.
- **Rows without preview** — if this equals `Total sampled + N`, your trace
  flag was off; turn `rag.queryLog.piiEnabled` on and rerun the window
  before promoting.

### Captured local dry-run (2026-04-25)

```text
$ DATABASE_URL=postgresql://postgres:postgres@localhost:5432/finsentinel \
  pnpm --filter @finsentinel/api rag:eval:promote -- \
  --dry-run --per-class 10 --since 2026-04-01T00:00:00Z

[promote-eval] FAILED: PostgresError: relation "rag_query_logs" does not exist
  code: 42P01
```

The author's local Homebrew Postgres is missing migration `V17__add_rag_query_logs`.
Apply it with `pnpm --filter @finsentinel/db db:migrate` against the local DB
(or run against staging) before exercising the wet-run path. The CLI parsing
and pipeline are exercised by the unit tests
(`apps/api/src/rag/eval/__tests__/rag-promote-eval.cli.spec.ts`) under
in-memory deps that mirror the real schema.

---

## Step 2: Live promotion

Once the dry-run summary looks reasonable, drop `--dry-run`:

```bash
DATABASE_URL=postgresql://.../finsentinel \
  pnpm --filter @finsentinel/api rag:eval:promote -- \
  --per-class 10 --since 2026-04-01T00:00:00Z
```

What changes:
- New rows are appended to `services/evaluation-runner/datasets/golden.json`
  with `provenance_label = "real_user_promoted"`.
- `golden.meta.json` gains a `promotion_log` array entry and `version`
  becomes `<previous-version>+promoted-<count>`.
- Rows whose `source_query_log_id` is already present in the dataset are
  skipped (idempotent re-runs are safe).

Expected diff in `golden.json`:

```diff
   {
     "id": "gs-100",
     ...
   }
+ ,{
+   "id": "promoted-<uuid>",
+   "query": "<redacted user query>",
+   "query_class": "factoid",
+   "expected_chunk_ids": ["<chunk-uuid-1>", "<chunk-uuid-2>"],
+   "acceptable_chunk_ids": [],
+   "expected_source_docs": [],
+   "expected_answer": "",
+   "expected_entities": [],
+   "difficulty": "unlabelled",
+   "tags": ["factoid", "real_user_promoted"],
+   "provenance_label": "real_user_promoted",
+   "source_query_log_id": "<uuid>",
+   "promoted_at": "2026-04-25T...",
+   "redactions_applied": []
+ }
```

---

## Step 3: Reviewer checklist (before committing the dataset change)

The CLI does the mechanical part; a human MUST review every promoted row.

- [ ] **PII spot-check.** Read every promoted `query` field. The regex
  redactor catches email / API-key / phone shapes but misses:
  account IDs, addresses, names, ticker portfolios that imply identity.
  If anything looks identifying, edit the row's `query` or drop the row
  entirely.
- [ ] **`expected_chunk_ids` are real chunk IDs.** They came from
  `result_chunk_ids` (i.e. what the system *retrieved*, not necessarily
  what was *correct*). For hard quality eval, replace these with the
  ground-truth chunks the reviewer believes should have been retrieved.
  If the reviewer cannot confidently label them, leave the row in but
  mark `difficulty: "unlabelled"` so eval scripts that gate on labelled
  ground truth can skip it.
- [ ] **Query-class balance.** Compare the new `golden.meta.json`
  `bucket_distribution` against the existing 100-row split. If a bucket
  jumps from 5% to 40% of the dataset, eval scores will skew. Drop rows
  to keep balance, or note the skew explicitly in the meta.
- [ ] **No duplicate `source_query_log_id`.** The CLI enforces this on
  append, but verify the diff before merging — duplicates inside one
  promotion batch are also dropped, but cross-batch from a manual edit
  is not auto-checked.
- [ ] **`golden.meta.json.version` bumped.** The CLI writes a
  `<previous>+promoted-<count>` suffix. If you edited rows by hand after
  promotion, bump again to `<...>+manual-<date>` so CI snapshots are
  invalidated.

---

## Rollback

```bash
git revert <commit-sha-of-the-dataset-change>
```

The version bump in `golden.meta.json` makes the rollback obvious in CI —
eval runs will see an unfamiliar version string and surface it in their
output.

If the dataset change has already been used by a published quality
report, also revert any references in `docs/exec-plans/` so the report's
provenance line keeps pointing at a real, in-tree dataset version.

---

## Known limitations

- **Labels are retrieved chunks, not ground truth.** A row promoted from
  `rag_query_logs` reflects what the system already retrieved. Treat
  promoted rows as a *baseline* of "what we currently do," not a
  *ground truth* of "what we should do." For item 6 (RAG 2048-dim tier
  strategy) and item 9 (query-planner classifier), the reviewer step
  above is the gate that turns baseline rows into eval truth.
- **PII redaction is regex-based.** It catches the obvious shapes (email,
  api-key prefix, phone). It does not catch names, addresses, account
  IDs, or anything semantic. The reviewer checklist is the actual PII
  gate.
- **`chat_messages` is not promoted by this CLI.** Phase 2.
- **The CLI caps at 5000 rows fetched per run** (see `LIMIT 5000` in the
  fetcher SQL). For larger windows, run multiple times with narrower
  `--since` ranges; the duplicate skip on `source_query_log_id` makes
  this safe.
