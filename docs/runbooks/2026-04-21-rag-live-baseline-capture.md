# RAG Live-API Baseline Capture — 2026-04-21

Closes the open P1.6 / P2 / P5 items from
`docs/exec-plans/2026-04-21-rag-quality-next-steps.md`.

## Environment

- macOS 14 dev box
- Postgres 17 (Homebrew-native, `localhost:5432`)
- Redis 8 (brew-installed, started as a bare `redis-server --daemonize yes`
  after the LaunchAgent path refused to stay up)
- Python 3.11 venv under `services/parser/.venv` for the real PDF/DOCX
  extractors (P4)
- Ephemeral DB `finsentinel_test` (dropped + recreated cleanly)

## Migrations

Fresh-DB migration required two upstream fixes (both landed this session):

| Migration | Fix |
|---|---|
| V16 | `embedding vector` → `embedding vector(1536)` so HNSW can index the column |
| V21 | adds `meta_title / meta_source / meta_entities / search_vector` columns + `idx_document_chunks_fts` that the Drizzle schema referenced but no prior SQL created |

```bash
psql postgres -c "CREATE DATABASE finsentinel_test"
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/finsentinel_test \
  pnpm --filter @finsentinel/db db:migrate
# [migrate] done: 21 applied
```

## Fixture seed

Used `--use-real-embeddings` (calls OpenRouter `text-embedding-3-small`)
so the cosine similarity between the seeded 41-chunk corpus and real query
embeddings is meaningful. `--stub-embeddings` produces deterministic stub
vectors that don't match query embeddings → 0 % recall on every live
query; avoid it for live-API eval.

```bash
DATABASE_URL=... FIXTURE_SEED_CONFIRM=1 \
  pnpm --filter @finsentinel/api rag:eval:seed-fixture \
    --corpus services/evaluation-runner/datasets/corpus.json \
    --use-real-embeddings
# writes 41 rows to document_chunks
```

## apps/api startup for eval

LLM-expensive planner features (rewrite / HyDE / decompose) are disabled
for eval runs so per-query latency stays under ~3 s; otherwise some
queries take 15-30 s and hit the evaluator's 30 s httpx timeout.

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/finsentinel_test \
REDIS_URL=redis://localhost:6379 \
RAG_EVAL_ENDPOINT_ENABLED=true \
RAG_QUERY_REWRITE_ENABLED=false \
RAG_HYDE_ENABLED=false \
RAG_QUERY_DECOMPOSE_ENABLED=false \
RAG_CONTEXT_EXPANSION_ENABLED=<off|on> \
PORT=3001 pnpm --filter @finsentinel/api start:dev
```

The new `RAG_EVAL_ENDPOINT_ENABLED=true` exposes `POST /api/rag/search`
via `RagSearchController`; without it the endpoint returns 403.

## P1.6 — Live-API baseline (expansion OFF)

```bash
python services/evaluation-runner/run_evaluation.py run \
  --dataset services/evaluation-runner/datasets/golden.json \
  --config services/evaluation-runner/configs/wave2-buckets.yaml \
  --output reports/p1-live-baseline-2026-04-21.json
```

**Overall:** recall@5 = 0.732, recall@10 = 0.741, mrr@10 = 0.733.

**Per bucket (recall@5 / recall@10 / mrr@10):**

| bucket | r@5 | r@10 | mrr@10 |
|---|---|---|---|
| exact_lookup | 0.950 | 0.950 | 0.950 |
| factoid | 0.867 | 0.867 | 0.833 |
| relational | 0.750 | 0.750 | 0.694 |
| analytical | 0.617 | 0.683 | 0.750 |
| multi_part | 0.750 | 0.750 | 0.750 |
| long_doc | 0.650 | 0.650 | 0.700 |
| cross_document | 0.450 | 0.475 | 0.500 |
| table_numeric | 0.500 | 0.500 | 0.450 |
| colloquial | 0.800 | 0.800 | 0.700 |

Baseline snapshot:
`services/evaluation-runner/reports/wave2-baseline-live-expansion-off-2026-04-21.json`.

## P5 — Live-API A/B (expansion ON)

Restart with `RAG_CONTEXT_EXPANSION_ENABLED=true` then re-run the same
command with `--output reports/p5-live-expansion-on-2026-04-21.json`.

**Overall:** recall@5 = 0.948 (+0.217), recall@10 = 0.968 (+0.227),
mrr@10 = 0.970 (+0.237).

**Per-bucket delta vs. baseline:**

| bucket | Δr@5 | Δr@10 |
|---|---|---|
| exact_lookup | +0.050 | +0.050 |
| factoid | +0.133 | +0.133 |
| relational | +0.208 | +0.250 |
| analytical | +0.117 | +0.117 |
| multi_part | +0.250 | +0.250 |
| long_doc | +0.250 | +0.250 |
| cross_document | +0.450 | +0.500 |
| table_numeric | +0.500 | +0.500 |
| colloquial | +0.200 | +0.200 |

Every bucket gained. exact_lookup/factoid, which the P5 plan conservatively
excluded from the expansion allow-list, still gained modestly (+0.050,
+0.133). The P5.6 default-flip condition is satisfied; flipped
`RAG_CONTEXT_EXPANSION_ENABLED` default to `true` in `rag.config.ts` and
`context-expander.service.ts`.

Baseline snapshot:
`services/evaluation-runner/reports/wave2-baseline-live-expansion-on-2026-04-21.json`.
Live-API config: `services/evaluation-runner/configs/live-api-baseline.yaml`
(floors at observed − 0.03 per bucket).

## P2 — Sparse backfill verification

Full enrichment via the production path (`rag:backfill:representations`
→ BullMQ → RepresentationEnrichConsumer) hit a pre-existing DI bug
(`RepresentationAdminService` constructor reads `this.configService.get`
on an undefined ConfigService in the CLI module). Filed as tech debt;
unrelated to P2.

Direct workaround: seed 164 representation rows (4 types × 41 chunks)
directly with `search_vector = NULL`, then run the sparse backfill CLI
against that state. This exercises exactly the code path P2 is concerned
with — insert-time `search_vector` wiring (R2) is not in play when
rows pre-date R2.

```sql
-- see runbook for exact INSERT using CROSS JOIN UNNEST; inserts 164 rows
-- with search_vector NULL
```

```bash
DATABASE_URL=... SPARSE_BACKFILL_CONFIRM=1 \
  pnpm --filter @finsentinel/api rag:backfill:sparse --batch-size 50
```

**Result:** 164 rows updated, 0 errors. `SELECT COUNT(*) FROM
document_chunk_representations WHERE search_vector IS NULL` → **0**.

Idempotency: re-ran the CLI; 0 rows updated; null count stayed at 0.

## Known gaps still deferred

- **Query rewrite + HyDE off** during eval. The live baseline reflects
  the literal query, not the rewritten form. Turning rewrite back on
  would require either a faster LLM provider or async-variant plumbing.
- **No reranker sidecar up.** All rerank calls fall through to RRF
  (expected behavior — rerank is optional). A real reranker would
  likely push mrr@10 even higher.
- **`RepresentationAdminService` DI bug** in the backfill-representations
  CLI. Pending debug + fix; does not block P2 wet-run verification once
  the bug is resolved.
