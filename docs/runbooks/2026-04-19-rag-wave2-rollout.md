# RAG Wave 2 Rollout Runbook

## Overview

Wave 2 fills the gaps left open by Wave 1 (T1..T8 in
`docs/exec-plans/2026-04-19-rag-redesign-plan.md`) so that
`RAG_MULTI_STAGE_ENABLED=true` can become the production default. The full plan
lives at `docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md`; this
runbook is the operator-facing companion.

For pattern reference, the multi-agent runtime rollout runbook at
`docs/runbooks/2026-04-16-multi-agent-runtime-rollout.md` shows the section
style and the flag-flip / rollback shape used at FinSentinel. This runbook does
not duplicate that content.

**Phase list:**

| Phase | Summary | Code-ready today |
|-------|---------|------------------|
| R1 | Evaluation gate as a release gate (golden set, CI workflow, baseline) | Yes, for offline CorpusRetriever mode |
| R2 | Representation sparse lane populates `search_vector` + backfill | No |
| R3 | Intent-aware query planner (exact-lookup preservation) | No |
| R4 | Metadata soft routing | No |
| R5 | PDF / Word ingestion via Markdown sidecar | No |
| R6 | Doc-type-aware chunking | No |
| R7 | Shadow, canary, default rollout of multi-stage | No |

This runbook covers **Phase R1 only**. Later phases will extend the runbook
with their own sections or link back to it.

## Running the eval gate

### Local smoke test

The shell script at `scripts/rag-eval-smoke.sh` reproduces the CI gate against
a local Postgres. It applies migrations, seeds the fixture corpus, and runs the
evaluator in offline `CorpusRetriever` mode. Expected wall clock is under 10
minutes.

```bash
# From repo root, with homebrew-native Postgres running on :5432 and a
# finsentinel_test DB:
createdb finsentinel_test  # one-time setup
bash scripts/rag-eval-smoke.sh
# Script prints PASS/FAIL + report path; exit code propagates.
```

> **Warning.** If `DATABASE_URL` is set and points at the real dev DB
> (`/finsentinel`, not `/finsentinel_test`), the smoke script prompts `y/N`
> and aborts on anything but `y`. When unset, the script defaults to
> `finsentinel_test` on localhost and warns loudly. Do not answer `y`
> against the shared dev DB.

### Offline evaluator run

The evaluator can also be driven directly. This does not need a database
because `CorpusRetriever` reads `corpus.json` from disk and scores via TF-IDF.

```bash
python3 -m venv .venv-eval
source .venv-eval/bin/activate
pip install -r services/evaluation-runner/requirements.txt
python3 services/evaluation-runner/run_evaluation.py run \
  --dataset services/evaluation-runner/datasets/golden.json \
  --config services/evaluation-runner/configs/ci-offline.yaml \
  --corpus services/evaluation-runner/datasets/corpus.json \
  --output services/evaluation-runner/reports/my-experiment.json
python3 services/evaluation-runner/run_evaluation.py compare \
  services/evaluation-runner/reports/wave2-baseline-offline.json \
  services/evaluation-runner/reports/my-experiment.json
```

### CI gate

The workflow at `.github/workflows/rag-eval-gate.yml` is the required check on
every RAG-touching PR.

- **Triggers** on PRs touching:
  - `apps/api/src/rag/**`
  - `apps/api/src/document/**`
  - `packages/db/migrations/V1[6-9]_*.sql`
  - `packages/db/migrations/V2[0-9]_*.sql` (forward-compat for later waves)
  - `services/evaluation-runner/**`
  - `services/reranker/**`
  - `.github/workflows/rag-eval-gate.yml` itself
- **Service containers:** `pgvector/pgvector:pg17` and `redis:7-alpine`, matching
  the images used by `docker-compose.yml`.
- **Mode:** offline `CorpusRetriever`. The workflow does **not** start
  `apps/api` and does **not** call OpenRouter. See the workflow YAML header for
  the full rationale (secret surface on public runners).
- **Gate:** fails non-zero when any `minimum_metrics` threshold in
  `services/evaluation-runner/configs/ci-offline.yaml` is violated.
- **Artifact:** the report is uploaded as `rag-eval-report-<sha>` (see the
  `actions/upload-artifact@v4` step); retention 14 days.

## Threshold rationale and when to swap configs

Two configs coexist on disk today:

- `services/evaluation-runner/configs/ci-offline.yaml` is the **current** CI
  config. It contains only overall `minimum_metrics:`, no
  `bucket_minimum_metrics:`. This matches the current synthetic golden set,
  which has no Wave 2 bucket tags. Current thresholds:

  | Metric | Floor |
  |--------|-------|
  | `strict.recall@5` | 0.30 |
  | `strict.recall@10` | 0.45 |
  | `lenient.recall@10` | 0.60 |
  | `strict.mrr@10` | 0.25 |

  These floors were set to "current baseline minus small margin" against the
  25-entry synthetic golden set under `CorpusRetriever` TF-IDF, so any
  retrieval regression trips the gate. Operators editing this file must
  justify any change in the PR description.

- `services/evaluation-runner/configs/wave2-buckets.yaml` is the **target** CI
  config after R1.1 lands. It adds `bucket_minimum_metrics:` entries for the
  five Wave 2 buckets: `exact_lookup`, `colloquial`, `cross_document`,
  `long_doc`, `table_numeric`.

  Do **not** swap before R1.1 ships. Until the golden set carries those five
  bucket tags, every bucket is empty and the gate would fail trivially with
  recall=0. Once R1.1 lands, the swap is a one-line change in
  `.github/workflows/rag-eval-gate.yml`; the step is currently
  `--config services/evaluation-runner/configs/ci-offline.yaml`.

## Rebuilding the baseline

The committed baseline is
`services/evaluation-runner/reports/wave2-baseline-offline.json`. It is the
reference point that later phases compare against via
`run_evaluation.py compare`.

**Rebuild the baseline when:**

- `services/evaluation-runner/datasets/corpus.json` changes.
- `services/evaluation-runner/datasets/golden.json` adds or removes entries.
- A retrieval algorithm change is explicitly declared by the team to be a new
  reference point, not a regression.

**How to rebuild:**

```bash
python3 services/evaluation-runner/run_evaluation.py run \
  --dataset services/evaluation-runner/datasets/golden.json \
  --config services/evaluation-runner/configs/ci-offline.yaml \
  --corpus services/evaluation-runner/datasets/corpus.json \
  --output services/evaluation-runner/reports/wave2-baseline-offline.json
git add services/evaluation-runner/reports/wave2-baseline-offline.json
git commit -m "chore(eval): rebaseline offline report after <reason>"
```

> **Warning.** Do not rebaseline merely to "make CI pass." If metrics
> regressed, that **is** the gate catching a regression. Root-cause the
> change before rebaselining.

## Rollback procedure

- **If multi-stage is later enabled as the default (after Phase R7) and a
  production incident is attributed to it:** set
  `RAG_MULTI_STAGE_ENABLED=false` in the production env and restart API
  workers. After R7 lands, the code at
  `apps/api/src/rag/rag-retrieval.service.ts` will read this flag and revert
  to the legacy single-stage path. Expected rollback time is about 1 minute.

- **If the CI gate itself is producing false failures after a config merge:**
  temporarily disable the workflow, either by deleting
  `.github/workflows/rag-eval-gate.yml` in a revert PR or by setting
  `if: false` on the `eval` job. Root-cause the false failure before
  re-enabling. Do **not** loosen thresholds as the fix.

- Report baselines are kept for at least 90 days for audit. They are committed
  files, so `git log services/evaluation-runner/reports/` is the record.

## Running the sparse backfill

After Phase R2 merges, any representation rows written BEFORE R2.2 landed still
have `search_vector = NULL` and are invisible to the sparse lane. The
`rag:backfill:sparse` CLI fills them in without regenerating embeddings or
calling the LLM.

**Dry run** (counts candidates, no writes):

```
pnpm --filter @finsentinel/api cli rag:backfill:sparse --dry-run
```

**Wet run** against the ephemeral CI / test DB (idempotent — re-running on a
fully backfilled DB touches zero rows):

```
pnpm --filter @finsentinel/api cli rag:backfill:sparse
```

**Wet run against the Homebrew-native dev DB** (requires explicit confirmation
env var, same pattern as `seed-fixture`):

```
SPARSE_BACKFILL_CONFIRM=1 pnpm --filter @finsentinel/api cli rag:backfill:sparse
```

Optional flags:

- `--batch-size <N>` — rows per UPDATE batch, default 500.
- `--representation-type <type>` — scope to one of `contextual_text |
  sample_question | summary | keyword_entity`; omit to backfill all types.
- `--output-summary <path>` — write a JSON summary (candidates scanned, rows
  updated, batches processed) to the given path for CI pipelines.

The CLI imports `buildRepresentationTsvector` from R2.2, so the backfilled
`search_vector` is identical to what a fresh insert would produce today. No
LLM calls, no embedding recompute, no other column touched.

## Known limitations and follow-up items

### Live-API CI path deferred

The current CI uses offline `CorpusRetriever`. A live-API CI path, where the
workflow starts `apps/api`, seeds the DB via `rag:eval:seed-fixture`, and runs
the evaluator against the real API, requires secrets (`JWT_SECRET`,
`OPENROUTER_API_KEY`, `POLYGON_API_KEY`) that cannot safely live in a
public-runner context. Plan: add a nightly or weekly self-hosted-runner
workflow as a separate job. This is not blocking Wave 2 progress.

### Golden set is synthetic

`services/evaluation-runner/datasets/golden.json` has 25 entries without Wave 2
bucket tags. R1.1 is the human-reviewer task that grows this to N >= 100
labelled entries across five buckets. Until then, bucket gates would trivially
pass or fail, so we use the overall-only `ci-offline.yaml`.

### `rag:eval:seed-fixture --with-enrichment` is a documented stub

When invoked without `--with-enrichment` (the default), seeding completes fast
and CI passes. When `--with-enrichment` is passed, the CLI prints a WARN on
stderr and does **not** actually enqueue representation enrichment. Operators
who need real representation coverage must run
`pnpm --filter @finsentinel/api rag:backfill:representations` separately.
Fix-forward when live-API CI ships.

### `ci-offline.yaml` to `wave2-buckets.yaml` swap

Gate-blocking follow-up. Do not swap before R1.1 lands real bucket tags; gates
would fail on empty buckets.

## Where to look for things

| Area | Path |
|------|------|
| Wave 2 plan | `docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md` |
| CI workflow | `.github/workflows/rag-eval-gate.yml` |
| Seed CLI | `apps/api/src/rag/eval/seed-fixture.cli.ts` |
| Smoke script | `scripts/rag-eval-smoke.sh` |
| Evaluator entry | `services/evaluation-runner/run_evaluation.py` |
| Evaluator metrics | `services/evaluation-runner/evaluators/topk_evaluator.py` |
| Baseline | `services/evaluation-runner/reports/wave2-baseline-offline.json` |
| Current CI config | `services/evaluation-runner/configs/ci-offline.yaml` |
| Target CI config (post R1.1) | `services/evaluation-runner/configs/wave2-buckets.yaml` |
| Golden set | `services/evaluation-runner/datasets/golden.json` |
| Corpus | `services/evaluation-runner/datasets/corpus.json` |

## R5 — Parser sidecar

**What this phase shipped:** a FastAPI stub sidecar that returns fixed
Markdown for any upload. Real PDF/Word parsing (MinerU, pdfplumber, or a
commercial OCR service) is a separate follow-up work-item; R5 validates
only the plumbing + distribution artefacts.

### Environment variables

| Variable                         | Default                   | Purpose                                                    |
|----------------------------------|---------------------------|------------------------------------------------------------|
| `PARSER_URL`                     | `http://localhost:8110`   | Base URL for the sidecar (used in compose: `http://parser:8110`). |
| `RAG_PARSER_TIMEOUT_MS`          | `30000`                   | Per-request timeout for a sidecar call.                    |
| `RAG_PARSER_MIN_MARKDOWN_CHARS`  | `50`                      | Below this length the client throws `PARSER_EMPTY_OUTPUT`. |
| `RAG_UPLOAD_MAX_BYTES`           | `104857600` (100 MiB)     | Hard upload cap applied before any sidecar call.           |

### Container / service

- Service name in `docker-compose.yml`: `parser`.
- Health endpoint: `GET /health` returns `{"status":"ok","version":"stub-0.1"}`.
- Image built by `services/parser/Dockerfile` (python:3.12-slim, exposes 8110).
- CI workflow: `.github/workflows/parser-build.yml` (builds + smoke-tests on push/PR that touches `services/parser/**`).

### Stub vs. real parser

The merged sidecar is a **stub**. For any uploaded file it returns the
same fixed Markdown template:

```
# <filename>

## Section 1

Stub parser output for <N> bytes.

## Section 2

Placeholder content for plumbing tests.
```

Do NOT interpret the R5 E2E pass as "PDF ingestion works in production" —
it proves the *plumbing* works (MIME whitelist, upload cap, sidecar
routing, chunk metadata enrichment). Replacing the stub with a real
parser is a separate follow-up scheduled independently.

### Run the E2E locally

```bash
docker compose up -d parser
RAG_PARSER_E2E=1 pnpm --filter @finsentinel/api test -- upload-pdf-e2e
```

The test uploads a fake PDF fixture, runs the full ingestion path
through the stub, and asserts a chunk gets persisted with
`metadata.parser_version` set.

### Kill switch

- Omit `PARSER_URL` (or set it to an unreachable host) to force all
  PDF/Word uploads to fail at the sidecar call. `VectorizeConsumer`
  marks the document `FAILED` on parse errors; the document row and
  DB state remain consistent.
- Synchronous uploads (when `VectorizeProducer` is absent) get
  `PARSER_SIDECAR_UNAVAILABLE` and land as `FAILED` too.

## R7 — Rollout ramp

The R7 phase ships the instrumentation to roll the multi-stage retrieval
pipeline from shadow → canary → default safely. This section covers the
operational playbook.

### Environment variables

| Variable                                     | Default                                                              | Purpose                                                                             |
|----------------------------------------------|----------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| `RAG_ROLLOUT_MODE`                           | `off`                                                                | `off` / `shadow` / `canary` / `on`. Fail-fast validation at config load.            |
| `RAG_SHADOW_SAMPLE_RATE`                     | `1.0`                                                                | Sample rate for shadow comparison rows (0..1).                                       |
| `RAG_SHADOW_TIMEOUT_MS`                      | `2000`                                                               | Per-request shadow timeout. User-visible latency unaffected (fire-and-forget).       |
| `RAG_SHADOW_CONCURRENCY`                     | `4`                                                                  | Max simultaneous shadow runs in the background.                                      |
| `RAG_SHADOW_MAX_QUEUE_DEPTH`                 | `200`                                                                | Queue cap before new shadow work is dropped with `shadow_dropped_backpressure=true`. |
| `RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS`        | `{"exact_lookup":100,"factoid":10,"relational":10,"analytical":10,"multi_part":10}` | JSON map, percentages 0..100.                            |
| `RAG_ROLLOUT_ANON_PERCENT_MULTIPLIER`        | `0.5`                                                                | Anon traffic canary percent = class percent × multiplier.                            |

### Ramp schedule

| Step | Duration | `RAG_ROLLOUT_MODE` | Other knobs                                                | Rollback trigger                                        |
|------|----------|--------------------|-------------------------------------------------------------|---------------------------------------------------------|
| 1    | 7 days   | `shadow`           | defaults                                                     | shadow timeout rate > 5% (watch `rag_shadow_outcome_total`) |
| 2    | 3 days   | `canary`           | `RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS='{"exact_lookup":100,"factoid":10,"relational":10,"analytical":10,"multi_part":10}'` (default) | error rate regression per `rag_retrieval_pipeline{mode}` |
| 3    | 3 days   | `canary`           | bump all classes to 50 (`{"exact_lookup":100,"factoid":50,"relational":50,"analytical":50,"multi_part":50}`) | P95 latency +30% vs single-stage baseline               |
| 4    | 3 days   | `canary`           | all classes 100                                              | eval gate regression                                     |
| 5    | —        | `on`               | flip default `RAG_MULTI_STAGE_ENABLED=true` (R7.7)           | —                                                        |

Single-stage code retirement lands **30 clean days** after Step 5 (tracked in R7.8).

### Kill switches

- `RAG_ROLLOUT_MODE=off` — reverts to whatever `RAG_MULTI_STAGE_ENABLED` dictates, canary disabled. Canary traffic returns to a pure-legacy serve immediately on config re-read.
- `RAG_MULTI_STAGE_ENABLED=false` — forces single-stage regardless of gate. Takes effect on next process restart (factory-scoped singleton).
- Drop the shadow queue: set `RAG_SHADOW_MAX_QUEUE_DEPTH=0` — every new shadow dispatch returns `dropped_backpressure`, persisted rows stay but no new work.

Both `RAG_ROLLOUT_MODE=off` and `RAG_MULTI_STAGE_ENABLED=false` are hard escape hatches. Apply whichever is faster to roll via your orchestrator.

### Dashboards to watch during ramp

- `rag_retrieval_pipeline{mode, query_class}` — traffic split between single_stage and multi_stage.
- `rag_shadow_outcome_total{outcome}` — `executed` / `timed_out` / `dropped_backpressure` / `errored` counts on the shadow path.
- Existing `rag_search_duration_seconds{status}` histogram — per-pipeline latency P50/P95/P99 (add a `pipeline` label dimension in a follow-up if needed).
- `rag_metadata_prefilter_downgrade_total{query_class}` (from R4.5) — spikes here during ramp are expected as multi-stage trips guardrails more often.

### Monitoring alerts (spec only — dashboards live in ops repo)

Paging conditions:

- `rag_shadow_outcome_total{outcome="timed_out"}` > 5% of total for 10 consecutive minutes → shadow pipeline is unstable, pause ramp.
- Error rate on `rag_retrieval_pipeline{mode="multi_stage"}` > single-stage baseline + 20% for 5 consecutive minutes → rollback ramp step.
- P95 latency on `rag_search_duration_seconds{pipeline="multi_stage"}` > 1.3× single-stage baseline for 5 consecutive minutes → rollback ramp step.

### Running the offline shadow analyser

```bash
DATABASE_URL=postgresql://... \
  python services/evaluation-runner/analyse_shadow.py \
    --since "now() - interval '7 days'" \
    --out reports/shadow-analysis.md
```

The analyser output is the primary gate between Step 1 → Step 2. Team review is required before ramping canary percentages.

### Applying the migration

Before flipping `RAG_ROLLOUT_MODE=shadow`:

```bash
pnpm --filter @finsentinel/db db:migrate
```

V19 (`rag_shadow_comparisons`) must be live in the target database or shadow writes will fail silently (via the `try/catch` in `RagTraceService.recordShadowComparison`).

### Retirement window (30 days, see R7.8)

Once Step 5 flips the default, the single-stage branch in
`RagRetrievalService` stays callable for **30 clean days**. "Clean" means:

- No paging alert on the multi-stage path.
- No eval gate regression.
- No parser or reranker sidecar incident requiring single-stage fallback.

Deletion is a separate follow-up commit tracked as R7.8. Revert via
`RAG_MULTI_STAGE_ENABLED=false` is the faster rollback path than a code
revert.
