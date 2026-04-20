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
