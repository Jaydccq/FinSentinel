# RAG Wave 2 — Production Readiness & Default-On Rollout

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the specific gaps that block FinSentinel RAG from turning `RAG_MULTI_STAGE_ENABLED` on as the production default, with shadow → canary → full rollout driven by the existing evaluation gate rather than a blind flag flip.

**Architecture:** Build on the work already landed in `feat/rag-redesign` (T1–T8; see `docs/exec-plans/2026-04-19-rag-redesign-plan.md`). Wave 2 adds: (a) real-labelled golden set + CI gate, (b) representation sparse lane actually writing `search_vector`, (c) intent-aware query planner that preserves the original query for exact-lookup, (d) soft-then-hard metadata routing, (e) PDF/Word ingestion via a Markdown contract, (f) doc-type-aware chunking, (g) shadow + canary + full rollout instrumentation for multi-stage.

**Tech Stack:** NestJS, Drizzle, PostgreSQL/pgvector + full-text search (`tsvector` with `setweight`), BullMQ, FastAPI reranker + (new) parser sidecar, Python evaluation runner, Prometheus metrics.

---

## Background

`feat/rag-redesign` (branch, unmerged as of 2026-04-19) introduced the multi-stage retrieval scaffolding: `document_chunk_representations` table, 4-type representation generator, query-variant planner, multi-lane orchestrator, rerank preamble + context expansion, partitioned `rag_query_logs` trace table, graph-relations contract. The branch ships with every new feature flag defaulting OFF, so merging it changes no user behaviour.

Independent verification (2026-04-19 exploration) confirmed the following gaps in the current code even if that branch merges:

- `ChunkRepresentationService` (`apps/api/src/rag/chunk-representation.service.ts:244–294`) inserts all four representation rows with `searchVector: null`. `SparseSearchService` queries `document_chunk_representations.search_vector @@ websearch_to_tsquery()` — but because the column is always null, that subquery returns zero rows. Contextual BM25, sample-question lexical match, and keyword/entity sparse match have **code without payoff**.
- `DocumentUploadService` (`apps/api/src/document/document-upload.service.ts:12–21`) allow-lists Markdown/text/CSV/HTML/XML/JSON. PDF is explicitly rejected. `DocumentParseService.parsePdf()` returns empty string with a warning. Financial reports, 10-Ks, and research PDFs cannot enter the corpus today.
- `MetadataPreFilterService` (`apps/api/src/rag/metadata-pre-filter.service.ts:22–41`) is a deliberate v1 passthrough that forwards `explicitFilters` unchanged and returns an empty `candidateDocIds`. Query text is never inspected for issuer/ticker/doc_type/time signals.
- `RetrievalPlannerService` (`apps/api/src/rag/retrieval-planner.service.ts:45–150`) classifies with regex into `factoid | relational | analytical | multi_part` — a reasonable coarse classifier, but query rewrite is global-default-on and reranker uses `plan.rewrittenQuery` rather than the original query. Exact-lookup questions ("What is Tesla's Q4 2025 revenue?", "Item 1A risk factors", "EPS for FY2024") can lose the literal tokens that drive precision.
- Chunking is **character-based** (`RAG_CHUNK_SIZE=500`, `RAG_CHUNK_OVERLAP=50`) across all doc types. `DocumentChunkingService.splitIntoSegments` uses paragraph → sentence → word boundaries with `string.length`. T3 (Markdown structure) respects heading boundaries for structured input, but there is no doc-type differentiation and no token-level accounting.
- `services/evaluation-runner/datasets/golden.json` is synthetic. The runner has a `minimum_metrics` gate but no CI job wires it in. There is no required-to-merge check on RAG-touching PRs.
- `RAG_MULTI_STAGE_ENABLED` defaults to `false` in `rag.config.ts`. There is no shadow-mode plumbing: the pipeline either runs single-stage or multi-stage, never both. Multi-stage results carry a hard-coded `similarity: 1.0` (`rag-retrieval.service.ts:213`) which is semantically wrong for callers that compare by cosine similarity.

GraphRAG and any "missing middle" (late-interaction / multi-vector between dense-sparse and rerank) are **out of scope for Wave 2**. They stay behind their current flags and will be revisited after Wave 2 eval results settle.

## Scope

**In scope**

- `apps/api/src/rag/` — planner, orchestrator, sparse lane, trace, score semantics, intent classifier.
- `apps/api/src/document/` — MIME allow-list, PDF/Word ingestion via sidecar + Markdown contract, doc-type chunker.
- `apps/api/src/rag/chunk-representation.service.ts` — populate `search_vector` (field-weighted) and backfill.
- `packages/db/` — any new migration strictly required by the above (expected: a `V18__*.sql` for `rag_query_logs.rollout_mode` + `rag_shadow_comparisons` only if needed; representation `search_vector` uses the existing V16 column).
- `services/evaluation-runner/` — wire CI gate, expand golden set with real labelled queries.
- `services/reranker/` (existing sidecar host) — a new `parser` route or a sibling sidecar that accepts PDF/Word bytes and returns structure-preserving Markdown + page/heading metadata.
- Rollout runbook at `docs/runbooks/2026-04-19-rag-wave2-rollout.md` (new file).

**Out of scope**

- GraphRAG default-on — remains `RAG_GRAPH_ENABLED=false`; Python sidecar relation extraction still open per T7 progress log.
- Late-interaction / ColBERT / multi-vector "missing middle" layer.
- Multimodal retrieval (PDF page images, ColPali).
- Swapping vector store or embedding provider.
- Changes to `apps/desktop/src-tauri` (kept compatibility-only per T8).
- Changes to the chat SSE contract.

## Assumptions

1. `feat/rag-redesign` will be merged to `main` before Wave 2 work starts, or Wave 2 rebases on top of it. All Wave 2 tasks assume V16 + V17 migrations are applied and T1–T8 code is present.
2. OpenRouter embedding + chat endpoints remain the sole LLM providers. No new model families introduced in Wave 2.
3. The existing BGE cross-encoder reranker sidecar (`RERANKER_URL`) stays. The PDF/Word parser is a **new sidecar contract**, not a change to the reranker sidecar.
4. `application/pdf` MIME + a structure-preserving Markdown conversion is acceptable as the ingestion contract. Heavy layout parsing (MinerU, pdfplumber+heuristics, or a commercial service) lives behind the sidecar; the API only guarantees it calls the sidecar and stores what comes back.
5. Postgres `tsvector` with `setweight` is sufficient for field-weighted sparse search. No Elasticsearch / OpenSearch added.
6. Golden set can be grown to N ≥ 100 labelled queries during R1 by a human reviewer running the `rag:golden:export` CLI shipped in T1.C. Real user queries in `chat_messages` / `agent_events` are accessible in staging.
7. The `postgres.js` mixed-default insert bug (Drizzle 0.44.x per `CLAUDE.md`) applies to every new insert. Use explicit every-column inserts or raw SQL.

## Prerequisites

- [x] Wave 1 (T1–T8) landed on `main` (verified 2026-04-19: V16 + V17 present at `packages/db/migrations/V16__add_rag_chunk_representations.sql` and `V17__add_rag_query_logs.sql`; `feat/rag-redesign` has no migration diff against main).
- [ ] V16 + V17 applied to the dev DB (`pnpm --filter @finsentinel/db db:migrate`).
- [ ] `RAG_ENRICHMENT_ENABLED=true` flipped in staging so representation rows are actually being generated before R2 backfill runs.
- [ ] Backfill dry-run (`pnpm --filter @finsentinel/api rag:backfill:representations --dry-run`) executed in staging and its output captured in `docs/runbooks/2026-04-19-rag-wave2-rollout.md`.

## Phase Sequencing

```
R1 Eval gate (real labelled golden set + CI gate)
  └─ must land first; every later phase uses it as verification

R2 Representation sparse lane (search_vector write + backfill + field weighting)
  └─ independent of R3; highest ROI; no retrieval semantics change for callers

R3 Intent-aware planner (exact lookup preservation + rewrite gating + rerank query source)
  └─ depends on R1 for bucketed eval verification

R4 Metadata soft routing
  └─ depends on R3's intent classifier output

R5 PDF/Word ingestion (Markdown contract + sidecar + fallback)
  └─ independent of R2–R4; required before R6 can differentiate doc types

R6 Doc-type-aware chunking
  └─ depends on R5 (need reliable doc_type + section signals from parser output)

R7 Shadow → canary → default rollout of multi-stage
  └─ depends on R1 (eval gate), R2–R6 (quality sources), and a new `rollout_mode` column
```

Each phase ships as its own PR. Each PR must run `pnpm typecheck` (narrow filters per `CLAUDE.md`), full `apps/api` test suite, and the offline eval runner against the current golden set. No phase flips a default flag until the eval gate passes its configured thresholds.

## Current State Pointers

- Exploration findings (2026-04-19, this session): confirmed every line-number claim in the user brief. Full report is embedded in the conversation history; summary above in Background.
- Predecessor plan: `docs/exec-plans/2026-04-19-rag-redesign-plan.md` (T1–T8 landed on `feat/rag-redesign`).
- Design doc: `docs/exec-plans/2026-04-19-rag-redesign-design.md`.
- Desktop compatibility doc: `docs/exec-plans/2026-04-19-desktop-rag-parity-notes.md`.

---

## Phase R1 — Evaluation Gate as a Release Gate

**Why this is first:** Every other phase promises quality gains. Without a real-labelled golden set and a CI gate that blocks merges on recall regressions, we cannot verify any of them, and multi-stage default-on becomes a guess.

### R1 Files

- Modify: `services/evaluation-runner/datasets/golden.json` — grow from synthetic N≈25 to real-labelled N≥100.
- Create: `services/evaluation-runner/datasets/golden.draft.json` — output of `rag:golden:export`, reviewed in PR.
- Create: `services/evaluation-runner/configs/cloud-singlestage-baseline.yaml` — captures current pre-Wave-2 numbers.
- Modify: `services/evaluation-runner/configs/cloud-multistage.yaml` — production thresholds per §R1 exit criteria.
- Create: `.github/workflows/rag-eval-gate.yml` — CI workflow.
- Create: `scripts/rag-eval-smoke.sh` — local reproduction of the CI gate.
- Modify: `services/evaluation-runner/run_evaluation.py` — add `--bucket` filter for per-class gating.
- Create: `services/evaluation-runner/evaluators/test_bucket_filter.py`.

### R1 Tasks

- [ ] **R1.1 — Grow the golden set to N≥100 real-labelled queries.**

  Use the `rag:golden:export` CLI from T1.C (real flags verified against `apps/api/src/rag/eval/golden-candidates.cli.ts:92`):

  ```bash
  pnpm --filter @finsentinel/api cli rag:golden:export \
    --limit-chat 30 \
    --limit-events 20 \
    --limit-reverse 25 \
    --output services/evaluation-runner/datasets/golden.draft.json \
    --dry-run
  ```

  (The plan's earlier draft used `--sources/--budget/--out` — those flags do not exist.)

  Then have a human reviewer split into 5 buckets with explicit `tags`:
  - `exact_lookup` (25) — "Tesla Q4 2025 revenue", "Item 1A risk factors", specific ticker/date lookups.
  - `colloquial` (25) — "why did Apple's services grow", "what's new with NVIDIA".
  - `cross_document` (20) — queries requiring synthesis across ≥2 docs.
  - `long_doc` (15) — queries whose answer lives in the deep middle of a long document.
  - `table_numeric` (15) — queries whose answer is a specific cell or numeric row.

  Each reviewed entry must populate `expected_chunk_ids`, `acceptable_chunk_ids`, `query_class`, `tags`, `difficulty`, `notes`. The reviewer signs off in the PR description.

  Verify: `python services/evaluation-runner/run_evaluation.py run --dataset services/evaluation-runner/datasets/golden.json --output services/evaluation-runner/reports/baseline.json --config services/evaluation-runner/configs/cloud-singlestage-baseline.yaml` completes and every entry in the golden set appears in the report.

- [ ] **R1.2 — Add per-bucket gating to the evaluator.**

  Extend `TopKEvaluator` so metrics can be computed per `tag`. Add a `--bucket` CLI flag and a `bucket_minimum_metrics:` config section:

  ```yaml
  # services/evaluation-runner/configs/cloud-multistage.yaml
  bucket_minimum_metrics:
    exact_lookup:
      strict.recall@5: 0.80
      strict.mrr@10:   0.70
    colloquial:
      lenient.recall@10: 0.85
    cross_document:
      lenient.recall@10: 0.70
    long_doc:
      lenient.recall@10: 0.70
    table_numeric:
      strict.recall@5:   0.65
  ```

  Write failing test first:

  ```python
  # services/evaluation-runner/evaluators/test_bucket_filter.py
  def test_bucket_filter_isolates_exact_lookup_metrics():
      entries = [
          GoldenEntry(id="g1", query="...", tags=["exact_lookup"], expected_chunk_ids=["c1"]),
          GoldenEntry(id="g2", query="...", tags=["colloquial"], expected_chunk_ids=["c2"]),
      ]
      results = {"g1": ["c1"], "g2": ["cx"]}  # c2 missed
      ev = TopKEvaluator(ks=[5])
      r = ev.evaluate(entries, results, bucket="exact_lookup")
      assert r["strict.recall@5"] == 1.0  # only g1 counted
  ```

  Run: `pytest services/evaluation-runner/evaluators/test_bucket_filter.py -v` → FAIL.

  Implement, then PASS.

  Verify: `python services/evaluation-runner/run_evaluation.py run --bucket exact_lookup ...` reports only exact-lookup entries.

- [ ] **R1.3 — Wire the CI gate (including explicit corpus-seeding).**

  `.github/workflows/rag-eval-gate.yml`:
  - Triggers on PRs touching `apps/api/src/rag/**`, `apps/api/src/document/**`, `packages/db/migrations/V1[6-9]_*.sql`, `services/evaluation-runner/**`, `services/reranker/**`.
  - Steps, in order:
    1. Spin up Postgres + Redis service containers.
    2. `pnpm --filter @finsentinel/db db:migrate` — apply V1..V17.
    3. **`pnpm --filter @finsentinel/api cli rag:eval:seed-fixture --corpus services/evaluation-runner/datasets/corpus.json`** — NEW CLI required for R1.3. It inserts fixture rows into `documents` + `document_chunks` with stable IDs matching the golden set's `expected_chunk_ids`/`acceptable_chunk_ids`, generates embeddings (stub or real, whichever the CI toggle selects), and runs the enrichment consumer to completion before yielding. Without this step the evaluator runs against an empty database and the gate is meaningless (this was the #3 Codex finding).
    4. Start `apps/api` with `RAG_MULTI_STAGE_ENABLED=true` and all quality flags on.
    5. Run `run_evaluation.py run ... --config configs/cloud-multistage.yaml`.
  - Fails the job if any `bucket_minimum_metrics` threshold fails.

  **Seed CLI contract (R1.3 extra):**
  - New file: `apps/api/src/rag/eval/seed-fixture.cli.ts`.
  - `corpus.json` entries must carry explicit `chunk_id` (string, UUID-stable) so golden set labels can point at real chunk rows after seed.
  - Embeddings: default stub (all-ones vector) for fast CI; optional `--use-real-embeddings` flag for a weekly full run.
  - Idempotent: re-running on a dirty DB drops fixture rows first (safe because CI DB is ephemeral; gated by a `FIXTURE_SEED_CONFIRM=1` env var if run against a non-ephemeral DB).

  Verify: a deliberately broken PR (e.g. stub `RetrievalOrchestratorService.orchestrate` to return `[]`) makes the gate job red; reverting makes it green. A second check: running the gate locally on a fresh Postgres produces the same pass/fail as CI within ±1 metric tick.

- [ ] **R1.4 — Freeze current single-stage performance as the baseline.**

  Run the evaluator against `main` with `RAG_MULTI_STAGE_ENABLED=false` and save to `services/evaluation-runner/reports/wave2-baseline-offline.json` (committed). Subsequent phases compare against this file via `run_evaluation.py compare`.

  Verify: the baseline file exists, is committed, and `compare reports/wave2-baseline-offline.json reports/<new>.json` runs without error.

- [ ] **R1.5 — Document the gate and the rollback.**

  Create `docs/runbooks/2026-04-19-rag-wave2-rollout.md` with sections:
  - How to run the eval locally (`scripts/rag-eval-smoke.sh`).
  - Thresholds and how they were chosen.
  - How to rebuild the baseline if the corpus fixture changes.
  - Rollback: flip `RAG_MULTI_STAGE_ENABLED=false` in env, revert the CI gate workflow, open incident.

### R1 Exit Criteria

- `services/evaluation-runner/datasets/golden.json` has ≥100 entries, each with real human-reviewed labels and a bucket tag.
- CI job `rag-eval-gate` runs on every RAG-touching PR and blocks merge on threshold violations.
- Baseline report is committed.
- `scripts/rag-eval-smoke.sh` reproduces the CI gate in under 10 minutes locally.

---

## Phase R2 — Representation Sparse Lane End-to-End

**Why:** `SparseSearchService` already joins `document_chunk_representations` on `search_vector`, but every representation row written by T2.B has `search_vector = NULL`. This phase is the single highest-ROI code change in Wave 2: code exists, infra exists, the line of code that populates `search_vector` is missing.

### R2 Files

- Modify: `apps/api/src/rag/chunk-representation.service.ts` — populate `searchVector` on every insert with field-weighted `to_tsvector`.
- Modify: `apps/api/src/rag/sparse-search.service.ts` — field-weighted ranking using `ts_rank_cd` + `setweight`.
- Create: `apps/api/scripts/rag-backfill-representation-sparse.ts` (or a CLI subcommand on the existing `rag:repr:reindex`) — backfill `search_vector` for rows that have it NULL without regenerating embeddings.
- Modify: `packages/db/src/schema/document-chunk-representations.ts` — no schema change; confirm `searchVector` is already `tsvector` nullable.
- Test: `apps/api/src/rag/__tests__/chunk-representation.service.sparse.spec.ts` (new) — asserts every representation write sets a non-null `search_vector`.
- Test: `apps/api/src/rag/__tests__/sparse-search.service.spec.ts` (extend) — field-weighting test cases.
- Test: `apps/api/scripts/__tests__/rag-backfill-representation-sparse.spec.ts` (new).

### R2 Tasks

- [ ] **R2.1 — Failing test: representation insert populates `search_vector`.**

  ```ts
  // apps/api/src/rag/__tests__/chunk-representation.service.sparse.spec.ts
  it('populates search_vector for every representation type on insert', async () => {
    const svc = new ChunkRepresentationService(/* deps */);
    const chunk = makeChunk({ content: 'Apple Inc. reported Q4 2025 revenue of $119.58 billion.' });

    await svc.enrich(chunk.id);

    const rows = await db.select().from(documentChunkRepresentations).where(eq(documentChunkRepresentations.chunkId, chunk.id));
    for (const r of rows) {
      expect(r.searchVector).not.toBeNull();
      expect(r.searchVector).toContain('apple');  // lexeme-normalised
    }
  });
  ```

  Run: `pnpm --filter @finsentinel/api test -- src/rag/__tests__/chunk-representation.service.sparse.spec.ts` → FAIL (current code writes null).

- [ ] **R2.2 — Minimal implementation: field-weighted `to_tsvector` per representation type.**

  **Text-search config must match existing sparse search.** `SparseSearchService` (`apps/api/src/rag/sparse-search.service.ts:35,76`) queries with `websearch_to_tsquery('simple', query)`. Any `to_tsvector` written on insert must use the same `'simple'` config, otherwise query tokens produced by `simple` will not match lexemes indexed under `english` (stemmer mismatch). Using `'english'` here would silently reduce sparse recall (this was the #5 Codex finding).

  In `chunk-representation.service.ts`, replace `searchVector: null` in each of the four insert sites with a **parameterised** Drizzle `sql\`\`` fragment — **never** `sql.raw()` with user content, which opens an injection vector on any quote/backslash/`$$` in chunk text. Pattern:

  ```ts
  searchVector: sql`setweight(to_tsvector('simple', coalesce(${title}, '')), 'A') ||
                    setweight(to_tsvector('simple', coalesce(${sectionPath}, '')), 'A') ||
                    setweight(to_tsvector('simple', coalesce(${contextual}, '')), 'B') ||
                    setweight(to_tsvector('simple', coalesce(${chunkTail}, '')), 'C')`,
  ```

  **Deliberate `english` migration is a separate follow-up:** if we want stemming, we migrate both the sparse query and all tsvector writes in one coordinated change with an eval-gate verification. Do NOT do it inside R2.

  Field weighting:

  | Representation type | `setweight` layout |
  |---|---|
  | `contextual_text` | A = title + section_path; B = contextual prose; C = chunk text tail |
  | `sample_question` | A = sample questions (joined); B = chunk content snippet |
  | `summary` | A = summary; C = title |
  | `keyword_entity` | A = entities; B = tickers; C = keywords |

  Use a helper `buildRepresentationTsvector(type, content, metadata)` that returns a `SQL` fragment. Test the helper in isolation.

  Because of the Drizzle mixed-default insert bug (`CLAUDE.md`), every column must still be set explicitly; the change is **only** to the `searchVector` field. Prefer `this.db.execute(sql\`INSERT ... \`)` if the `.values()` form becomes awkward with `setweight` composition.

  Verify: R2.1 test PASSES; existing `rag-chunk-store` tests still pass.

- [ ] **R2.3 — Failing test: sparse lane ranks weighted fields.**

  ```ts
  // apps/api/src/rag/__tests__/sparse-search.service.spec.ts (extension)
  it('ranks title hits above chunk tail hits for representation search', async () => {
    // two chunks: one has query term in title (weight A), other has it only in chunk body (weight C)
    const hits = await sparseSearch.search({ query: 'counterparty risk', topK: 10 });
    expect(hits[0].chunkId).toBe(titleHitChunkId);
  });
  ```

  Run → FAIL (current sparse service does not use `ts_rank_cd` with weights).

- [ ] **R2.4 — Implement `ts_rank_cd` with weight vector.**

  Modify `sparse-search.service.ts` to use `ts_rank_cd('{0.1, 0.2, 0.4, 1.0}', search_vector, query)` (D, C, B, A reading order — higher weight for A-labelled lexemes). Configurable via `RAG_SPARSE_WEIGHTS` env var (default `"{0.1,0.2,0.4,1.0}"`).

  Verify: R2.3 test PASSES.

- [ ] **R2.5 — Backfill existing representation rows without regenerating embeddings.**

  **The backfill must JOIN `document_chunks` to get title / section_path / metadata.** Representation rows only store `{ index_version }` in metadata today, and their `content` is the generated text (e.g., the contextual paragraph), not the canonical title or section path. Title and section path live on `document_chunks.meta_title` + `document_chunks.metadata->sectionPath`. Regenerating `search_vector` from the representation row alone would miss the A-weighted title/section lexemes (this was the #6 Codex finding).

  Create `apps/api/scripts/rag-backfill-representation-sparse.ts`:
  - Iterates `document_chunk_representations r LEFT JOIN document_chunks c ON c.id = r.chunk_id` where `r.search_vector IS NULL`.
  - For each (representation_type, content, chunk.meta_title, chunk.metadata) tuple, computes the weighted tsvector using the same helper `buildRepresentationTsvector(type, {title: c.meta_title, sectionPath: c.metadata->sectionPath, content: r.content, keywords: c.metadata->keywords, entities: c.metadata->entities})`.
  - Updates only the `search_vector` column on the representation row (no LLM calls, no embedding recompute).
  - Supports `--dry-run`, `--batch-size` (default 500), `--where "representation_type = 'contextual_text'"`.
  - Emits a progress log every N batches to avoid silent stalls on large tables.

  **Consequence for R2.2:** the insert-time `buildRepresentationTsvector()` also needs the parent chunk's title/section_path at insert time. Thread those fields into `ChunkRepresentationService.enrich()` from the caller (which already reads the chunk to generate the 4 rep types). No extra DB read.

  Make it a CLI command on the existing NestJS commander CLI host (`apps/api/src/cli/`).

  Verify: on a dev DB with 10 rows (5 null, 5 populated), `--dry-run` reports 5 rows would update; wet run updates exactly 5 rows; re-running reports 0.

- [ ] **R2.6 — Eval bucket verification.**

  Run `cloud-multistage.yaml` eval before and after R2. Expected: `exact_lookup` bucket `strict.recall@5` improves by ≥5 pp; `colloquial` bucket unchanged or improved. No regression on other buckets.

  Record numbers in the plan's Progress Log.

- [ ] **R2.7 — Metric: `rag_representation_sparse_populated_total{type}` counter.**

  Add a Prometheus counter incremented once per representation row that successfully writes `search_vector`. Expose via the existing Prometheus endpoint.

  Verify: staging sees the counter rise 1:1 with representation enrichment events.

### R2 Exit Criteria

- Zero representation rows in staging with `search_vector IS NULL` after backfill (SQL assertion in the runbook).
- Sparse lane test suite proves field weighting behaves as specified.
- Eval bucket `exact_lookup` strict.recall@5 improves by ≥5 pp over R1 baseline, verified via the CI gate.
- Counter `rag_representation_sparse_populated_total` monotonically increasing in staging.

---

## Phase R3 — Intent-Aware Planner: Preserve Original Query for Exact Lookup

**Why:** Current planner rewrites every query by default and reranker uses `plan.rewrittenQuery`. For an `exact_lookup` question like "Item 1A risk factors" or "AAPL Q4 2025 EPS", rewriting into "What are the key risks described in Item 1A?" dilutes the literal tokens that drive precision. The existing `queryClass` signal is available but not used to gate rewrite behaviour or the reranker query source.

### R3 Files

- Modify: `apps/api/src/rag/retrieval-planner.service.ts` — add `exact_lookup` query class; gate rewrite by class.
- Modify: `apps/api/src/rag/retrieval-orchestrator.service.ts` — expose `rerankQuery` distinct from `plan.rewrittenQuery`.
- Modify: `apps/api/src/rag/rag-retrieval.service.ts` — pass `plan.rerankQuery` (falls back to original) to `reranker.rerank()`.
- Modify: `apps/api/src/rag/query-variant.service.ts` — no rewrite variant for `exact_lookup` class; HyDE and decomposition remain disabled for exact lookups.
- Modify: `packages/shared/src/enums/` — add `RETRIEVAL_QUERY_CLASS_EXACT_LOOKUP` if the enum is shared across boundaries.
- Test: `apps/api/src/rag/__tests__/retrieval-planner.service.spec.ts` (extend).
- Test: `apps/api/src/rag/__tests__/rag-retrieval-exact-lookup.spec.ts` (new).

### R3 Tasks

- [ ] **R3.1 — Add `exact_lookup` as a fifth query class.**

  Heuristics (regex + deterministic; ticker must pass a whitelist lookup):
  - Contains ALLCAPS ticker candidate (`\b[A-Z]{2,5}\b`) **that appears in a whitelist** (sourced from `packages/db` market data or the existing market service; reject bare `\b[A-Z]{2,5}\b` because it matches "THE", "AND", "FOR", "USA", "CEO", "CFO", "USD", "ISO", etc.) plus a time anchor (`Q[1-4]|FY\d{2,4}|20\d{2}`), or
  - Contains section-identifier patterns (`Item \d+[A-Z]?`, `Section \d+(\.\d+)*`, `Note \d+`), or
  - Contains numeric-identifier patterns (`ISIN [A-Z0-9]{12}`, `CUSIP [A-Z0-9]{9}`, `EPS`, `P/E`), or
  - User explicitly quoted a phrase with double quotes.

  **Ticker whitelist source:** resolve during R3 implementation — either from an existing market data table in `packages/db/src/schema/` or by calling the existing market service. If no whitelist is available, fall back to requiring ticker + time anchor + doc_type keyword to triple-gate the classification.

  Classification precedence: `exact_lookup > multi_part > analytical > relational > factoid`.

  Test names to add:
  - `classifies "AAPL Q4 2025 EPS" as exact_lookup`
  - `classifies "Item 1A risk factors" as exact_lookup`
  - `classifies quoted phrase "net sales" as exact_lookup`
  - `does not classify "why did Apple's services grow" as exact_lookup`

- [ ] **R3.2 — Gate rewrite by intent.**

  In `retrieval-planner.service.ts`:

  ```ts
  const shouldRewrite = this.rewriteEnabled
    && plan.queryClass !== 'exact_lookup'
    && query.trim().length > 0;
  ```

  Variant generation: if `exact_lookup`, emit only the original variant. HyDE and decomposition are already flag-gated; add an explicit skip for `exact_lookup` so they cannot be turned on for this class via env var.

- [ ] **R3.3 — Expose `rerankQuery` on the plan.**

  Extend `RetrievalPlan`:

  ```ts
  export interface RetrievalPlan {
    queryClass: QueryClass;
    variants: QueryVariant[];
    rewrittenQuery: string;      // kept for backward compatibility with T5.A
    rerankQuery: string;          // NEW: the query text the reranker should score against
    filters: Record<string, unknown>;
    enabledLanes: Lane[];
    fallbackFlags: string[];
  }
  ```

  Selection rule: `rerankQuery = queryClass === 'exact_lookup' ? originalQuery : rewrittenQuery`.

- [ ] **R3.4 — Use `rerankQuery` in `RagRetrievalService.searchMultiStage`.**

  Change `reranker.rerank(plan.rewrittenQuery, fused, topK * 2)` to `reranker.rerank(plan.rerankQuery, fused, topK * 2)` at `apps/api/src/rag/rag-retrieval.service.ts:187`.

  Add a regression test that asserts, for a ticker-Q-date query, the reranker sidecar receives the original literal query text — not a rewritten paraphrase.

- [ ] **R3.5 — Fix the similarity semantics for multi-stage results (backward-compatible).**

  **Codex finding #9 forced a redesign of this task.** Dropping the `similarity` field on multi-stage breaks `news-analysis.service.ts:120` (`result.similarity * 100` → `NaN%`), `retrieval-orchestrator.service.ts:182` (sorts by similarity), the evaluator (reads `.similarity`), and two tests. Those callers cannot all be migrated inside R3 without widening scope.

  **New design:** `similarity` stays **required** on `RagSearchResult` and is always populated. For multi-stage results it is defined as "the best available score, normalised to [0, 1]": `rankScore` if rerank succeeded, else `fusionScore`. Add `rankScore` and `fusionScore` as **optional** fields for callers that want to see the raw components.

  ```ts
  interface RagSearchResult {
    chunkId: string;
    sourceId: string;
    content: string;
    metadata: Record<string, unknown>;
    similarity: number;          // REQUIRED. Single-stage: cosine. Multi-stage: best available score normalised to [0, 1]. Always monotonic.
    rankScore?: number;          // Multi-stage only, when reranker succeeded. Raw reranker score.
    fusionScore?: number;        // Multi-stage only, when reranker fell back to RRF. Raw RRF score.
    scoreSource?: 'cosine' | 'rerank' | 'rrf';  // Provenance, for traces.
  }
  ```

  Fix the `similarity: 1.0` hard-code at `rag-retrieval.service.ts:213` to `similarity: normaliseToUnit(rankScore ?? fusionScore)`. Normalisation formula decided in code: min-max normalise per-batch using min/max of the returned top-K, or sigmoid if the reranker score is unbounded. Pick one and document it in the code comment; add a test that asserts the output is in [0, 1] and monotonic with the raw score.

  **Caller audit before starting:** run `grep -rn '\.similarity' apps/ packages/` and confirm every caller still works under the new monotonic-but-rescaled semantics. Known consumers from Codex's audit: `news-analysis.service.ts:120`, `retrieval-orchestrator.service.ts:182`, `rag-retrieval.service.ts:90,91,98,307,308,310`, `rag-chunk-store.service.ts:145,235,281`, two test files.

  **Any caller that uses `.similarity` as a raw cosine (e.g., threshold 0.65) must either read `scoreSource` and skip the threshold on non-cosine paths, or be migrated to use a class-appropriate threshold.** This is tracked as regression guards in the test suite.

  Verify: full `apps/api` test suite green; a new integration test asserts `rankScore` present on multi-stage results with reranker available, `fusionScore` present on fallback, `similarity` absent on both.

- [ ] **R3.6 — Eval bucket verification.**

  After R3, `exact_lookup` bucket `strict.recall@5` should improve vs R2. `colloquial` bucket unchanged (rewrite still applies there).

### R3 Exit Criteria

- Planner emits `rerankQuery` distinct from `rewrittenQuery`.
- `exact_lookup` queries never hit the rewrite/HyDE/decomposition path.
- Reranker receives literal original query for exact-lookup queries (verified by a mock-sidecar test).
- `similarity` / `rankScore` / `fusionScore` semantics are distinct and type-safe.
- Eval gate passes with no regression on other buckets.

---

## Phase R4 — Metadata Soft Routing

**Why:** `MetadataPreFilterService` is a pass-through. The corpus has structured signals (doc_type, sector, region_id, date, source) on every chunk via `document_chunks.metadata`. Queries like "10-K 2024" can be pre-filtered to a much smaller candidate set.

**Codex finding #7 correction:** the original plan assumed every chunk has issuer + ticker in metadata. Verification against `apps/api/src/document/document-vector.service.ts:86` shows the vectorizer only writes `doc_type`, `sector`, `region_id`, `source`, `date`, plus structural fields. **Issuer and ticker are not guaranteed** on existing chunks. R4 must therefore land in two sub-phases:

- **R4.0 (NEW): ingestion metadata backfill for issuer/ticker.** Add an `issuerName` / `tickers` field to the chunk metadata schema, write it during ingestion, and backfill existing chunks with a best-effort extractor (regex over chunk content + source filename + `documents.meta_title`). This is a prerequisite for ticker-aware soft routing. Shipping R4.1–R4.5 without R4.0 produces a router that can only filter on doc_type/sector/region/date/source — still useful, but much less than the plan originally implied.
- **R4.1–R4.5:** build the router using whatever metadata is present after R4.0.

### R4 Files

- **R4.0** — Modify: `apps/api/src/document/document-vector.service.ts` — add `issuerName` / `tickers` extraction into chunk metadata at ingestion time.
- **R4.0** — Create: `apps/api/scripts/rag-backfill-chunk-issuer-tickers.ts` — backfill CLI for existing chunks.
- Create: `apps/api/src/rag/query-entity-extractor.service.ts` — regex-first, LLM-fallback extractor.
- Modify: `apps/api/src/rag/metadata-pre-filter.service.ts` — soft vs hard filter decision based on confidence score.
- Modify: `apps/api/src/rag/retrieval-orchestrator.service.ts` — pass filter hints into each lane's SQL `WHERE` clause at lane entry.
- Modify: `apps/api/src/config/rag.config.ts` — add `RAG_METADATA_PREFILTER_MODE` (off | soft | hard, default `soft`), `RAG_METADATA_HARD_FILTER_MIN_CONFIDENCE` (default `0.85`).
- Test: `apps/api/src/rag/__tests__/query-entity-extractor.service.spec.ts` (new).
- Test: `apps/api/src/rag/__tests__/metadata-pre-filter.service.spec.ts` (extend).

### R4 Tasks

- [ ] **R4.1 — Build the extractor with regex-first, LLM-fallback (with cost + latency guardrails).**

  Because R4 runs on every query in the hot path, the LLM fallback must carry the same guardrails the representation enrichment uses in T2.B: concurrency cap (`RAG_METADATA_LLM_CONCURRENCY`, default 4), 429 circuit breaker (halt after 3 consecutive 429s, exponential backoff), per-request timeout (`RAG_METADATA_LLM_TIMEOUT_MS`, default 1500), and an explicit `RAG_METADATA_LLM_FALLBACK_ENABLED` master flag (default `false` — turn on only after cost is validated in staging).

  Regex path is always enabled. LLM fallback is opt-in per deploy.


  Extract fields: `ticker[]`, `issuerName[]`, `docType` (10-K | 10-Q | 8-K | news | research | filing | other), `timeRange` ({ after?: Date, before?: Date }), `sector[]`, `region[]`. Each field carries a `confidence` in [0, 1].

  Regex first (free, deterministic):
  - Ticker: `\b[A-Z]{2,5}\b` intersected against a curated ticker set — confidence 0.95.
  - Date: `FY\d{4}`, `Q[1-4]\s*20\d{2}`, `\b20\d{2}\b` — confidence 0.85–0.95.
  - Doc type: literal matches "10-K", "10-Q", "annual report" — confidence 0.9.

  LLM fallback: only when regex produces no hits and the query is long enough to justify the LLM call. Prompt schema enforced with zod, failures degrade to empty filters with a `fallbackFlag`.

- [ ] **R4.2 — Soft vs hard filter decision.**

  ```ts
  buildFilter(query, explicitFilters, extracted): PreFilter {
    const merged = { ...explicitFilters, ...extractedHighConfidence };
    const mode = this.mode;
    if (mode === 'off') return { hardFilter: explicitFilters };
    if (mode === 'hard' || allAboveConfidence(extracted, this.hardMin)) {
      return { hardFilter: merged };
    }
    // soft: use merged as a boost, not an exclusion
    return { softFilter: merged, hardFilter: explicitFilters };
  }
  ```

  Soft filters are surfaced as lane-specific boosts: the dense lane adds a metadata predicate that `ORDER BY` bumps matching rows, but non-matching rows are still retrievable. Hard filters become `WHERE` clauses.

- [ ] **R4.3 — Integrate into the orchestrator.**

  At lane entry (`searchRepresentations` and `sparseSearch.search`), compose the hard filter into the SQL. Emit a trace field `applied_hard_filter: {...}` so R1's eval runner can tie retrieval failures back to over-aggressive filtering.

- [ ] **R4.4 — Eval bucket verification.**

  `exact_lookup` bucket: `strict.recall@5` should improve further vs R3 (smaller candidate set, cleaner top-K). `cross_document` bucket: unchanged or improved. If any bucket regresses, the phase must drop the hard-filter threshold or disable the offending extractor rule.

- [ ] **R4.5 — Guardrails against over-filtering (per-class min thresholds).**

  `RAG_METADATA_MIN_CANDIDATES_BY_CLASS` (JSON, default `{"exact_lookup": 5, "colloquial": 20, "analytical": 30, "multi_part": 30, "relational": 20, "factoid": 15}`). If the hard filter produces a candidate set smaller than the class threshold, downgrade to soft filter and emit `fallbackFlag: 'prefilter_downgraded'` in the trace.

  Rationale: for exact-lookup, 10 candidates is a feature (precision boost); for colloquial, 10 is too few and the user will see empty answers.

  Test: an ambiguous ticker combined with a generic colloquial query should downgrade to soft filtering; a specific exact-lookup query that returns 10 candidates should NOT downgrade.

### R4 Exit Criteria

- `MetadataPreFilterService` is no longer a passthrough.
- All test buckets pass the CI gate.
- Trace logs show `applied_hard_filter` on exact-lookup queries in staging.

---

## Phase R5 — PDF/Word Ingestion via Markdown Contract

**Why:** Financial corpus is PDF-heavy. The current allow-list blocks PDF outright. Heavy parsing (MinerU, pdfplumber, a commercial OCR service) does not belong inside the API process.

### R5 Files

- Create: `services/parser/` (new FastAPI sidecar, or extend the existing reranker sidecar with a `/parse` route — TBD by the sidecar owner) — accepts `POST /parse` with a file and a `doc_type_hint`, returns structure-preserving Markdown plus metadata (pages, headings, tables, page_count).
- Create: `services/parser/Dockerfile` (if new sidecar), `services/parser/routers/parse.py`.
- Modify: `apps/api/src/document/document-upload.service.ts` — accept `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- **Modify: `apps/api/src/queue/vectorize.consumer.ts` (Codex finding #1) — this is where PDFs actually get parsed in production (the synchronous upload path is not where the heavy lift happens).** The consumer currently calls `parseService.parseToCleanText()` at line 107 regardless of MIME. Route PDF/Word MIMEs (detected via `documents.meta_source` / filename extension / magic bytes) through `ParserSidecarClient.parse()` instead, persist the resulting structure-preserving Markdown back into `document_parse_cache` or a similar durable store so retries don't re-upload the bytes, and fall through to the existing parser for text-like MIMEs. Without this change, queued ingestion ignores R5 entirely and PDFs remain empty.
- Create: `apps/api/src/document/parser-sidecar.client.ts` — typed client with zod response schema, timeout + retry, circuit breaker.
- Modify: `apps/api/src/document/document-parse.service.ts` — delete the "returns empty string" PDF branch; inject the sidecar client instead (so both paths — sync upload and async consumer — go through the same integration).
- Modify: `apps/api/src/document/structured-document.ts` — extend the metadata schema to include `sourceMimeType`, `pageCount`, `parserVersion`.
- Test: `apps/api/src/document/__tests__/document-upload.service.spec.ts` (extend) — accepts PDF MIME, rejects corrupt PDF with clear error.
- Test: `apps/api/src/queue/__tests__/vectorize.consumer.pdf.spec.ts` (new) — asserts the consumer routes PDF to the sidecar client and persists non-empty Markdown.
- Test: `apps/api/src/document/__tests__/parser-sidecar.client.spec.ts` (new).

### R5 Tasks

- [ ] **R5.1 — Define the sidecar contract as a zod schema first (no sidecar code yet).**

  ```ts
  // apps/api/src/document/parser-sidecar.client.ts
  export const ParserSidecarResponse = z.object({
    markdown: z.string().min(1),
    metadata: z.object({
      pageCount: z.number().int().nonnegative(),
      headings: z.array(z.object({
        level: z.number().int().min(1).max(6),
        text: z.string(),
        pageStart: z.number().int().nullable(),
      })),
      tableCount: z.number().int().nonnegative(),
      parserVersion: z.string(),
      sourceMimeType: z.string(),
    }),
  });
  ```

  Write the client with the contract. Use `fetch` with timeout (`RAG_PARSER_TIMEOUT_MS`, default 30_000) and circuit breaker (open on 3 consecutive failures, probe every 30 s).

- [ ] **R5.2 — Accept PDF/Word MIMEs in the upload service.**

  Add to `ALLOWED_MIME_TYPES`:

  ```ts
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ```

  Route these through `ParserSidecarClient.parse()` instead of `DocumentParseService.parse()`. If the sidecar returns fewer than `RAG_PARSER_MIN_MARKDOWN_CHARS` (default 50), treat as parse failure and reject the upload with a 422 + `PARSER_EMPTY_OUTPUT` code.

  **Upload size cap:** confirm the existing upload path has a `MAX_FILE_SIZE` limit that covers 100 MB+ 10-K filings. If none exists, add `RAG_UPLOAD_MAX_BYTES` (default 100 MiB) and reject oversized PDFs with a 413 + `PAYLOAD_TOO_LARGE` code **before** touching the sidecar (do not send large bytes across the network only to reject them).

- [ ] **R5.3 — Propagate structural signals into the chunker.**

  Pass `metadata.headings` and `metadata.pageCount` into `MarkdownStructureService.parse()` — the heading list becomes the section spine and avoids the fragile regex heading detection.

- [ ] **R5.4 — Sidecar skeleton + distribution plan.**

  **Scope note:** this plan does not prescribe the sidecar implementation — ship the contract + client + TypeScript tests first, with a stub sidecar returning a fixed Markdown payload so integration tests can run. The real parser (MinerU, pdfplumber+heuristics, or a commercial service) is a follow-up work-item and owned by the sidecar team.

  **Distribution artifacts (must ship with R5, not deferred):**
  - `services/parser/Dockerfile` — even for the stub. Mirrors the pattern in `services/reranker/`.
  - `services/parser/pyproject.toml` or `requirements.txt` — FastAPI + zod-validated schemas on the Python side.
  - `docker-compose.yml` — add a `parser` service wired to `PARSER_URL`.
  - `.github/workflows/parser-build.yml` (or the existing services CI file extended) — builds the image and pushes to the same registry the reranker image uses.
  - Env var `PARSER_URL` added to `rag.config.ts` and the operator runbook.
  - Health endpoint `GET /health` returning `{status: "ok", version: "…"}`.

  Without these, the stub merges but cannot be deployed, and the next developer re-invents the deploy path.

- [ ] **R5.5 — End-to-end test: PDF upload → chunks → retrieval.**

  Add a fixture PDF to `apps/api/test/fixtures/pdf/10k-sample.pdf`. Test: upload returns 201, document is ingested, representation enrichment runs, a query that targets a known chunk in the PDF returns it via the eval runner.

### R5 Exit Criteria (scoped honestly — Codex finding #13)

- API accepts PDF uploads (sync + queue paths) without error **against the stub sidecar** — this validates the integration plumbing, NOT real PDF parsing quality.
- `VectorizeConsumer` routes PDF/Word MIMEs to the sidecar client and persists non-empty Markdown into the chunk pipeline.
- Sidecar contract is versioned and documented in `docs/runbooks/2026-04-19-rag-wave2-rollout.md`.
- Fallback behaviour on sidecar outage: upload rejected with a clear error code; queued ingestion enqueues into a DLQ with a traceable reason; no silent data loss.
- E2E test with a fixture PDF through the stub sidecar produces a known chunk set; this proves plumbing, not production-quality PDF extraction.

**Explicit non-exit-criterion:** real PDF/Word ingestion quality (layout, tables, headings, images) is NOT validated by R5. That lands when the real parser sidecar ships — tracked as a separate follow-up, not a Wave 2 deliverable.

---

## Phase R6 — Doc-Type-Aware Chunking

**Why:** A 500-char character-based chunk works badly for three cases: tables (one chunk may split a row from its header), FAQ pages (a question and its answer can end up in different chunks), and long reports (section boundaries don't align with character boundaries).

### R6 Files

- Modify: `apps/api/src/document/document-chunking.service.ts` — dispatch on doc type.
- Create: `apps/api/src/document/chunkers/report-chunker.ts` — section-aware semantic chunking (extends T3's `MarkdownStructureService`).
- Create: `apps/api/src/document/chunkers/qa-chunker.ts` — question-answer pair detection.
- Create: `apps/api/src/document/chunkers/table-chunker.ts` — one chunk per logical table segment, always prepended with header row and table caption.
- Modify: `apps/api/src/config/rag.config.ts` — per-doc-type chunk size config (`RAG_CHUNK_SIZE_REPORT`, `RAG_CHUNK_SIZE_QA`, `RAG_CHUNK_SIZE_DEFAULT`).
- Test: `apps/api/src/document/__tests__/chunkers/*.spec.ts` (new).

### R6 Tasks

- [ ] **R6.1 — Decide unit: tokens or chars? (evidence-driven, not opinion-driven)**

  Before writing any new chunker, decide the unit of measurement. Current code uses chars. Token-based uses `tiktoken` or similar.

  **Recommendation direction:** tokens. Reasons: (a) all downstream limits (rerank payload, LLM context) are token-based, (b) English/CJK mixed corpus has dramatically different char-to-token ratios, (c) token limits align with embedding provider's max input.

  **Required evidence before committing:**

  Run a 1000-chunk benchmark that compares:
  - Embedding API failure rate (did any chunk exceed provider max input under each scheme?)
  - Per-chunk token count distribution (mean, p95) for a representative corpus (mix of English financial reports and CJK news)
  - Wall-clock ingest time (tokenizer overhead vs pure char splitting)

  Commit the benchmark script to `apps/api/test/bench/chunking-unit-benchmark.ts` so the decision is reproducible.

  Implementation once decided: if tokens win, add a `tokenizer` adapter using the same tokenizer the embedding client uses; default chunk size `480 tokens, 64 tokens overlap`. If chars win, document per-doc-type char sizes in the runbook.

  **Do not start R6.2 until the benchmark runs and the decision is recorded in the plan's Key Decisions.**

- [ ] **R6.2 — Report chunker.**

  Input: `StructuredDocument` from `MarkdownStructureService`. Behaviour:
  - Respect heading boundaries as hard splits.
  - Within a section, merge small blocks until approaching chunk size; split on paragraph/sentence boundary.
  - Tables are emitted as whole chunks (use table-chunker).
  - Fenced code blocks stay intact.
  - Carry `sectionPath`, `title`, `parentId`, `pageStart`, `pageEnd` on every output chunk.

- [ ] **R6.3 — Q&A chunker.**

  Heuristic: a question is a line ending in `?` or a line matching `^(Q:?|Question:?|#{1,3}\s*Q\d+)`. The associated answer is every subsequent line up to the next question or `^(A:?|Answer:?)` boundary. One chunk per `(question, answer)` pair, both kept together with `modality='text'`.

- [ ] **R6.4 — Table chunker.**

  For any `modality='table'` block from `MarkdownStructureService`:
  - If the table fits in the chunk budget, emit it whole with the table caption (if any) and the enclosing section path.
  - If not, split row-wise, but **every split chunk must include the header row** as the first line and the caption/section path in metadata.

- [ ] **R6.5 — Dispatch in the chunking service.**

  ```ts
  chunkStructured(doc: StructuredDocument): StructuredChunk[] {
    const docType = classifyDocType(doc);  // report | qa | table_heavy | default
    switch (docType) {
      case 'report':      return this.reportChunker.chunk(doc);
      case 'qa':          return this.qaChunker.chunk(doc);
      case 'table_heavy': return this.tableChunker.chunk(doc);
      default:            return this.defaultChunker.chunk(doc);
    }
  }
  ```

  Doc-type classifier: simple heuristic on structural signals — ratio of heading density, table density, question-line density.

- [ ] **R6.6 — Reindex existing docs (with drain + wait checkpoint).**

  Add a CLI subcommand `rag:reindex:by-doctype` that re-chunks existing documents with the new chunkers. Dry-run prints counts per doc type; wet run replaces chunks via `RagChunkStoreService.replaceChunks` (cascades to representations via ON DELETE CASCADE — `rag-chunk-store.service.ts:54`).

  **Drain + wait checkpoint (Codex finding #14):** after `replaceChunks`, new representation rows are enqueued but not yet generated. Running the eval gate against a doc whose old representations were just deleted and new ones haven't finished enriching will report artificial recall regressions.

  CLI must therefore:
  1. Replace chunks in batches.
  2. Wait for the representation enrichment worker's BullMQ queue to drain (poll `waitingCount + activeCount == 0` + a 30 s stability window), or until `--max-wait-seconds` (default 1800).
  3. Emit a `--wait-skipped` flag + structured warning if the drain wait times out, so operators know eval results may be unstable.
  4. Idempotent re-runs: if a doc already has the latest chunker version stamped in `documents.metadata`, skip it unless `--force`.

  Test: end-to-end reindex on a 10-doc fixture → verify all new representations exist before the CLI exits with success.

- [ ] **R6.7 — Eval bucket verification.**

  - `table_numeric` bucket: `strict.recall@5` should improve materially.
  - `long_doc` bucket: `lenient.recall@10` should improve.
  - `exact_lookup` bucket: unchanged or improved.

### R6 Exit Criteria

- Three chunker variants exist and are selected by doc-type classifier.
- Reindex CLI is available and idempotent.
- Eval gate passes.
- Chunk stats dashboard in Grafana shows per-doc-type chunk count and size distribution.

---

## Phase R7 — Shadow → Canary → Default Rollout of Multi-Stage

**Why:** The quality improvements from R2–R6 need to be proven on real production traffic, not only on the golden set, before `RAG_MULTI_STAGE_ENABLED` can become the default. This phase adds the instrumentation to compare single-stage and multi-stage on live traffic, then ramps via query-class-aware canary.

### R7 Files

- Modify: `apps/api/src/rag/rag-retrieval.service.ts` — add `shadow` mode that runs both pipelines and returns the single-stage result while logging the multi-stage comparison.
- Modify: `packages/db/migrations/V18__add_rag_rollout_comparisons.sql` (new) — adds `rag_shadow_comparisons` table.
- Create: `packages/db/src/schema/rag-shadow-comparisons.ts`.
- Modify: `apps/api/src/rag/rag-trace.service.ts` — persist the shadow comparison.
- Create: `apps/api/src/rag/rollout-gate.service.ts` — decides per-request which pipeline to use based on query-class-aware canary percentage.
- Modify: `apps/api/src/config/rag.config.ts` — add `RAG_ROLLOUT_MODE` (off | shadow | canary | on, default `off`), `RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS` (JSON).
- Create: `docs/runbooks/2026-04-19-rag-wave2-rollout.md` (extend from R1) — rollout playbook.
- Test: `apps/api/src/rag/__tests__/rollout-gate.service.spec.ts` (new).

### R7 Tasks

- [ ] **R7.1 — Shadow mode.**

  When `RAG_ROLLOUT_MODE=shadow`:
  - Run single-stage as the source of truth; return its result to the caller.
  - In parallel, run multi-stage and capture its top-10 chunk IDs + timings.
  - Persist both into `rag_shadow_comparisons` with fields:
    - `query_hash` (SHA-256)
    - `single_stage_chunk_ids` (string[])
    - `multi_stage_chunk_ids` (string[], `[]` if multi_stage failed)
    - `single_stage_latency_ms`, `multi_stage_latency_ms` (nullable)
    - `query_class`
    - `shadow_timed_out` (bool, default false)
    - **`multi_stage_error` (string | null)** — zod-serialised error message when multi-stage throws; this is what lets the offline analyser distinguish "retrieval returned empty" from "pipeline crashed"
    - `created_at`
  - Never block the request on the shadow run; use `allSettled` + per-request timeout.
  - **Sample rate:** `RAG_SHADOW_SAMPLE_RATE` (default `1.0`) — non-fallback queries sampled at this rate; shadow errors and timeouts are always logged regardless (failure mining stays complete, same pattern as `rag_query_logs`).

  The shadow run contributes **zero** to the user-visible latency budget: if it exceeds `RAG_SHADOW_TIMEOUT_MS` (default 2000 ms), cancel and persist a partial row with `shadow_timed_out: true` and `multi_stage_error: 'timeout'`.

  **Backpressure + pool protection (Codex finding #12).** Fire-and-forget shadow work in the same API process still consumes CPU, DB pool slots, and reranker sidecar capacity. Implementation requirements:
  - Shadow runs are queued through a dedicated `p-queue` (or BullMQ worker) with `RAG_SHADOW_CONCURRENCY` (default 4) — NOT run directly in the request handler's event-loop tick.
  - A dedicated Postgres read-only connection pool of size `RAG_SHADOW_DB_POOL_SIZE` (default 4) isolates shadow queries from user-facing traffic.
  - When the shadow queue depth exceeds `RAG_SHADOW_MAX_QUEUE_DEPTH` (default 200), new shadow requests are dropped with `shadow_dropped_backpressure: true` and counted via `rag_shadow_dropped_total{reason="backpressure"}`. Shadow is opportunistic; dropping is preferable to slowing user-visible retrieval.
  - Shadow **never** writes to user-facing caches (if any) and **never** emits traces to user-visible logs.

  Test: a stubbed multi-stage that throws must produce a row with `multi_stage_error` set and the user-visible response still arriving from single-stage (assert no 5xx to the caller). A separate load test simulates 1000 RPS and asserts (a) user-visible P99 latency does not regress vs baseline, (b) `rag_shadow_dropped_total` rises under burst.

- [ ] **R7.2 — Offline analyser.**

  Add a Python script `services/evaluation-runner/analyse_shadow.py` that reads `rag_shadow_comparisons`, computes per-class overlap-at-k, latency deltas, and cites specific queries where the two pipelines diverge most. Output: a Markdown report the team reviews before ramping canary.

- [ ] **R7.3 — Canary gate.**

  When `RAG_ROLLOUT_MODE=canary`:
  - `RolloutGateService.decide(queryClass, stickinessKey)` returns `'multi_stage'` with probability `RAG_ROLLOUT_CANARY_PERCENT_BY_CLASS[queryClass]`, else `'single_stage'`.
  - Defaults start at `{"exact_lookup": 100, "colloquial": 10, "analytical": 10, "multi_part": 10, "relational": 10, "factoid": 10}` — exact-lookup is the lowest-risk class for multi-stage now that R3 preserves the original query.
  - **Stickiness key (handles anon traffic):**
    - Authenticated user: `hash(userId + hour-floor)` for 30-min stickiness.
    - Anon user: `hash(sessionId + hour-floor)` if a session cookie is available.
    - No session: `hash(ipAddress + hour-floor)` as last resort.
    - If none of the above are available, pick by request-id (no stickiness) and emit `rag_rollout_no_stickiness_total{reason}` so we can see how much of the traffic lacks sticky routing.
  - **Anon traffic caution:** anon canary percent should default **lower** than authenticated for every class (plan for `RAG_ROLLOUT_ANON_PERCENT_MULTIPLIER`, default `0.5`). Anon traffic often comes from high-conversion widgets where a rare multi-stage error hurts more than for an authenticated power user.

  Emit a Prometheus label `rag_retrieval_pipeline{mode="single_stage"|"multi_stage",class="...",auth="user"|"anon"}` so traffic split is observable.

  Test: pass `userId=null, sessionId=null, ipAddress='203.0.113.5'` — gate must still decide deterministically and emit `rag_rollout_stickiness_source_total{source="ip"}`.

- [ ] **R7.4 — Canary monitoring.**

  Grafana dashboard panels (spec only; dashboard JSON lives in ops repo):
  - Error rate per pipeline per class.
  - P50/P95/P99 latency per pipeline per class.
  - Fallback flag rates (rerank_malformed, rerank_unavailable, prefilter_downgraded) per pipeline.
  - Answer-groundedness delta (if the groundedness verifier is live).

  Alert: any of these regress >20% vs the single-stage baseline for >5 minutes → page.

- [ ] **R7.5 — Ramp schedule (documented, not code).**

  The runbook specifies the ramp cadence:

  | Step | Duration | Action | Rollback trigger |
  |------|----------|--------|------------------|
  | 1 | 7 days | Shadow all traffic | Shadow timeout rate >5% |
  | 2 | 3 days | Canary: exact_lookup 100%, others 10% | Error rate regression |
  | 3 | 3 days | Canary: 50% across all classes | P95 latency +30% |
  | 4 | 3 days | Canary: 100% across all classes | Eval gate regression |
  | 5 | — | Flip default `RAG_MULTI_STAGE_ENABLED=true` and remove single-stage code after one clean week | — |

- [ ] **R7.6 — Flip the default.**

  **Codex finding #10 correction:** `Boolean(process.env['X']) !== false` is a JS bug — `Boolean("false")` is `true` because "false" is a non-empty string, so the flag cannot be turned off. Use explicit string comparison.

  Also, the multi-stage check in the runtime is `rag-retrieval.service.ts:48` reading `RAG_MULTI_STAGE_ENABLED` directly via `process.env`. Either the config and the service read-site must both change, or the runtime must migrate to read from config.

  **Concrete change:**

  ```ts
  // apps/api/src/config/rag.config.ts
  multiStageEnabled: process.env['RAG_MULTI_STAGE_ENABLED'] !== 'false',  // default ON; set to "false" (string) to disable
  ```

  ```ts
  // apps/api/src/rag/rag-retrieval.service.ts  (replaces the direct process.env read at line 48)
  this.multiStageEnabled = configService.get<boolean>('rag.multiStageEnabled', true) as boolean;
  ```

  The env var becomes an escape hatch; default is on; the only way to disable is `RAG_MULTI_STAGE_ENABLED=false` (literal string).

  Test: set env to `"false"` → flag is false. Set to `"true"` → true. Unset → true. Set to empty string → true (unset-equivalent).

- [ ] **R7.7 — Retire the single-stage code path.**

  After **30 clean days** (not 7) with `RAG_MULTI_STAGE_ENABLED` defaulting on — long enough to cover at least one full weekly eval cycle and one on-call rotation — delete:
  - The single-stage branch in `RagRetrievalService.search`.
  - The legacy similarity-only `RagSearchResult` fields that single-stage set.
  - The flag-off regression test from T1.A.

  The 30-day window is the minimum to ensure that if the reranker or parser sidecar has a production incident during business hours and again during off-hours, single-stage is still available as the revert path. Revert via flag flip is much cheaper than revert via code revert + re-deploy.

  Keep the `compare_reports` baselines for at least 90 days for audit.

### R7 Exit Criteria

- Shadow comparisons land in the DB at production volume for ≥7 days with <5% timeout rate.
- Offline analyser shows multi-stage beats single-stage on ≥3 of 5 buckets without regressing any.
- Canary ramps to 100% across all query classes with no paging alert for 3 consecutive days.
- Default flag flipped (R7.6). **Single-stage code retirement is a separate, later step: see R7.7. The 30-day retention window is authoritative; any earlier retirement is out of scope.**

---

## Verification Approach

Every phase must pass:

```bash
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/db typecheck
pnpm --filter @finsentinel/api test -- src/rag
pnpm --filter @finsentinel/api test -- src/document

python services/evaluation-runner/run_evaluation.py run \
  --dataset services/evaluation-runner/datasets/golden.json \
  --config services/evaluation-runner/configs/cloud-multistage.yaml \
  --output services/evaluation-runner/reports/<phase>-<date>.json

python services/evaluation-runner/run_evaluation.py compare \
  services/evaluation-runner/reports/wave2-baseline-offline.json \
  services/evaluation-runner/reports/<phase>-<date>.json
```

The `compare` step must succeed (no configured threshold violated) before the phase is declared done.

## Key Decisions

_(Fill in as phases execute.)_

- **Chunking unit (tokens vs chars):** TBD in R6.1. Recommendation is tokens; char fallback documented.
- **PDF parser implementation:** TBD in R5. The plan only commits to the contract; the parser is a follow-up.
- **Ticker whitelist for metadata extraction:** sourced from existing `packages/db` market data (if available) or `apps/api/src/market/`; decide on first R4 implementation attempt.
- **Rerank vs fusion score as public score:** R3.5 proposes three distinct fields. If downstream callers cannot be updated in Wave 2, keep `similarity` as an alias for whichever score is authoritative per path and add a deprecation note.

## Risks and Blockers

- **Golden set labelling bandwidth.** Growing to 100 real-labelled queries requires human reviewer time. Mitigation: R1.1 proposes a split of 25/25/20/15/15 that a single reviewer can complete in 1–2 days using the candidate export CLI.
- **Parser sidecar availability.** PDF-heavy phases (R5, R6) depend on a parser sidecar that does not yet exist in this repo. Mitigation: R5.4 ships a stub sidecar + the contract, and real parsing is a follow-up — R6 can still work on Markdown-converted inputs produced out-of-band.
- **Representation backfill cost.** R2.5 only updates `search_vector`, no LLM calls, so cost is negligible. But if embeddings also need regeneration later, schedule a separate reindex.
- **Canary cost.** Shadow mode doubles RAG compute cost for 7 days. Mitigation: add a `RAG_SHADOW_SAMPLE_RATE` knob (default 1.0) so a partial sample can be used if cost is a concern.
- **Multi-stage latency regression.** Multi-stage has more stages (planner + metadata extraction + dense + sparse + fusion + rerank + expansion) and can push P99 higher. Mitigation: R7.4 adds latency-per-pipeline monitoring; R3.5 exposes fusion/rankScore so callers can trade latency for quality.
- **Reviewer trust in the eval gate.** A new CI gate will initially be flaky or slow. Mitigation: R1.3 runs on a small fixture corpus (seeded in CI, not production data) so runtime is bounded and reproducible.

## Progress Log

- **2026-04-19:** Plan authored by the planning session. Reviewed the predecessor plan (`2026-04-19-rag-redesign-plan.md`) and confirmed Wave 2 scope is purely additive on top of T1–T8. No code written in this session.
- **2026-04-19 (plan-eng-review):** 14 findings (6 P1 architecture/code-quality, 3 P2, 5 P3 + test/perf), all addressed inline. 0 unresolved.
- **2026-04-19 R1.2 (subagent-driven-development):** Per-bucket gating shipped on `feat/rag-wave2-r1` — 3 commits (`91a1273` / `5004966` / `2db1c4c`), 8 new tests, spec + code-quality review both passed.
- **2026-04-19 R1.3 (subagent-driven-development):** `rag:eval:seed-fixture` CLI + CI workflow + smoke script + R1.2 follow-ups — 7 commits total (`b084417`, `6c9826f`, `d7ec40b`, `95ced05`, `6cead84`, `7d826c8`, `9ed9b97`), 17 new unit tests + 2 new Python regression tests, 1226/1226 api tests pass. Decisions: CI evaluates in offline CorpusRetriever mode (not live-API) due to secret requirements; transitional `ci-offline.yaml` used until R1.1 tags the golden set; seed enrichment flag inverted (default off, `--with-enrichment` opt-in) after code review feedback.
- **2026-04-19 R1.4:** Offline baseline frozen as `services/evaluation-runner/reports/wave2-baseline-offline.json`. Note: the plan originally said `wave2-baseline-singlestage.json`; renamed because the CI runs the offline CorpusRetriever path, not a live-API single-stage pipeline. A true live-API single-stage baseline is a follow-up when the live-API CI workflow ships (tracked in R1.5 runbook). Current synthetic-golden-set metrics: strict.recall@5 = 0.9867, strict.recall@10 = 1.0000, strict.mrr@10 = 0.8967 — artificially high because `golden.json` is self-consistent with `corpus.json`; real numbers land after R1.1.
- **2026-04-19 R1.5:** Operator runbook landed at `docs/runbooks/2026-04-19-rag-wave2-rollout.md` (222 lines), commit `574404b`. Covers: overview + phase map, running the gate locally/offline/CI, threshold rationale + ci-offline→wave2-buckets swap-point, baseline rebuild, rollback procedure, known limitations (live-API deferred, synthetic golden, enrichment stub), path index.
- **2026-04-19 R1 cross-task review:** R1.2–R1.5 land coherently on `feat/rag-wave2-r1`; 32/32 evaluator tests green, api+db typecheck clean, branch ready to PR against `main`. R1.1 (human-gated golden-set labelling) remains the one open prerequisite before the `ci-offline.yaml` → `wave2-buckets.yaml` gate swap.
- **2026-04-19 R1 landed:** merged to `main` at `4b21e9f` via `--no-ff` merge commit; 13 commits grouped under the merge header; pushed to `origin/main`. R1 branch cleaned up.
- **2026-04-19 R2.1+R2.2 (subagent-driven-development):** Representation `search_vector` populated on insert. 3 commits (`f9d4e57` test / `509ecaf` impl / `8ca7feb` docs) on `feat/rag-wave2-r2`. 13 new tests (10 helper + 3 service). `buildRepresentationTsvector` helper extracted to `chunk-representation.tsvector.ts`, uses `'simple'` config to match `SparseSearchService`. `keyword_entity` weights the whole blob at A because upstream LLM schema doesn't split entities/tickers/keywords (tracked as `[RAG-TD-01]` in `docs/exec-plans/tech-debt-tracker.md`). Canonical-chunk tsvector still `'english'` — asymmetry tracked as `[RAG-TD-02]`.
- **2026-04-19 R2.3+R2.4 (subagent-driven-development):** Field-weighted sparse ranking via `ts_rank_cd` + `RAG_SPARSE_WEIGHTS` env var. 3 commits (`3a5b06a` test / `0aed340` impl / `e9acdfc` DI fix). 4 new tests. Default weights `{0.1, 0.2, 0.4, 1.0}` (D → A), zod-validated as a 4-tuple at config load. DI wiring fix (`e9acdfc`) was caught by code-quality review — without `useFactory` the env var would have been decorative in production.
- **2026-04-19 R2.5 (subagent-driven-development):** Sparse backfill CLI at `apps/api/src/rag/admin/rag-backfill-representation-sparse.cli.ts`. Flags: `--dry-run`, `--batch-size <N>` (default 500), `--representation-type <type>`, `--output-summary <path>`, and `SPARSE_BACKFILL_CONFIRM=1` env-var guard for non-ephemeral DBs. Reuses `buildRepresentationTsvector` from R2.2, JOINs `document_chunks` for title + section_path + content. Idempotent — re-running on a fully backfilled DB touches zero rows. 19 unit tests pass. Runbook updated with "Running the sparse backfill" section.
- **2026-04-19 R2.7:** Prometheus counter `rag_representation_sparse_populated_total{type, source}` emitted from `ChunkRepresentationService` — 4 increments per successful enrich (one per rep type, `source=insert`). New assertion test at `chunk-representation.service.sparse.spec.ts`. 4/4 tests pass, typecheck clean. Backfill CLI does NOT wire into Prometheus directly (short-lived process can't be scraped); its per-type counts land in the existing `--output-summary` JSON instead.
- **2026-04-19 R2.6 deferred:** eval-bucket verification is blocked on live-API CI. The offline CI CorpusRetriever does NOT go through `SparseSearchService`, so the R2 sparse-lane improvements cannot be measured by the current offline gate. R2.6 proper — `exact_lookup` bucket `strict.recall@5` before/after R2 — lands when the live-API CI workflow from R1.5's rollout runbook ships. Already tracked there.
- **2026-04-19 R2 landed:** merged to `main` at `40f7570` via `--no-ff` merge commit; 10 commits grouped under the merge header; pushed to `origin/main`. R2 branch cleaned up.
- **2026-04-19 R3.1+R3.2 (subagent-driven-development):** `exact_lookup` query class + rewrite/HyDE/decompose gating. 3 commits (`6fb2f69` test / `7303331` classifier / `54cc326` gating) on `feat/rag-wave2-r3`. 10 new planner tests. Chose Option C for ticker whitelist: 50 US large-caps + ETFs hardcoded at `apps/api/src/rag/ticker-whitelist.ts` with migration path to DB-backed `instruments` table documented inline (Option A was unavailable — only watchlist/holdings in DB; Option B's triple-gate fallback with doc-type keyword is layered IN for long-tail tickers). Classification precedence: exact_lookup > multi_part > analytical > relational > factoid. HyDE/decompose short-circuited via early-return so env-var flags can't re-enable them for exact_lookup.
- **2026-04-19 R3.3+R3.4 (subagent-driven-development):** `rerankQuery` field on `RetrievalPlan` + `searchMultiStage` integration. 3 commits (`f1fbe94` test / `e84458f` plan extension / `cca71db` call-site swap). 9 new tests (7 planner + 2 retrieval). Selection rule: `rerankQuery = queryClass === 'exact_lookup' ? originalQuery : rewrittenQuery`, with empty-string fallback to `originalQuery`. `rewrittenQuery` kept intact for backward compat. Retrieval-level test deliberately diverges `rewrittenQuery` from `rerankQuery` in the mock — strong mutation-test property (revert to `plan.rewrittenQuery` fails the assertion).
- **2026-04-19 R3.5 (subagent-driven-development):** Backward-compatible score semantics per codex finding #9. 4 commits (`3fe2c2d` test / `b42cb10` normaliser / `2260ae4` interface+fix / `b92d342` defensive log). 17 new tests (10 normalisation + 7 provenance). `RagSearchResult.similarity` stays REQUIRED and always populated; `rankScore?` / `fusionScore?` / `scoreSource?: 'cosine' \| 'rerank' \| 'rrf'` added as optional provenance. Chose **Option C hybrid** normalisation: sigmoid for unbounded reranker scores, identity-with-clamp for RRF scores (bounded to ~0.2 by construction given k=60 + ≤12 lane-variant hits; sigmoid would collapse into [0.5, 0.55] and kill UI rank separation). Full caller audit done — 7 call sites verified, `news-analysis.service.ts:120` pattern `result.similarity * 100` produces valid percentages on all 3 code paths.
- **2026-04-19 R3.6 deferred:** same reasoning as R2.6. Offline CorpusRetriever does not go through `RetrievalPlannerService` or the reranker — so `exact_lookup` recall delta before/after R3 cannot be measured by the current gate. Verification lands with the live-API CI workflow.
- **2026-04-19 R3 cross-task:** 10 commits on `feat/rag-wave2-r3`; full rag suite 323/323, agent suite 105/105, typecheck clean. Branch ready to merge to main.
- **2026-04-19 (codex review, session `019da7d9-c027-7980-908b-c6ddd9283658`):** 15 additional findings after independent repo read. 6 CRITICAL — plan would not execute as written — all corrected inline:
  1. R5 re-scoped to include `VectorizeConsumer` (real PDF parse path).
  2. R1.1 CLI flags corrected to real `--limit-chat / --limit-events / --limit-reverse / --output / --dry-run`.
  3. R1.3 CI gate now requires explicit `rag:eval:seed-fixture` CLI to hydrate DB.
  4. R2.2 tsvector config aligned with existing `simple` (not `english`) to match `SparseSearchService`.
  5. R2.5 backfill re-scoped to JOIN `document_chunks` for title / section_path / keywords / entities.
  6. R4 split: added R4.0 (ingestion metadata backfill for issuer/ticker) as a prerequisite.
  Plus R3.5 redesigned for backward compatibility (`similarity` stays required, `rankScore`/`fusionScore` added as optional provenance fields), R5 exit criteria scoped honestly to "plumbing validated with stub", R7.1 backpressure/pool/queue-depth guardrails, R7.6 flag logic bug fixed (JS `Boolean("false")` trap), R7 contradiction resolved (30-day window authoritative), R6.6 drain+wait checkpoint added.
- **2026-04-20 R4 landed on `feat/rag-wave2-r4`:** 10 tasks, 22 commits on top of `c51e8bd` (plan-doc commit). All tasks shipped via `superpowers:subagent-driven-development` (implementer + spec reviewer + code-quality reviewer + targeted fix-up per task). 1357/1357 api tests pass; `@finsentinel/api` + `@finsentinel/db` typecheck clean. Flag-off regression snapshot unchanged. Offline eval gate (`configs/ci-offline.yaml`) green: `strict.recall@5 = 0.9867`, `strict.recall@10 = 1.0000`, `strict.mrr@10 = 0.8967` — identical to the R1 offline baseline, no regression. R4 highlights:
  - **R4.0** ingestion metadata extension (issuer/ticker) + `rag:backfill:chunk-issuer-tickers` CLI + sentinel `__originalFileName` threaded through the 3 ingestion call sites (VectorizeConsumer, DocumentUploadService sync fallback, news-enrich consumer — news path uses `title` in lieu of a filename).
  - **R4.1** `QueryEntityExtractorService` with regex-first path (ticker whitelist, docType, FY/Q/Year), LLM fallback with duck-typed `LlmClientLike`, Promise.race timeout, half-open circuit breaker (3 consecutive failures → 30s open + counter reset for fresh recovery), zod-validated response.
  - **R4.2** `MetadataPreFilterService` upgraded from passthrough to config-driven soft/hard decision with `shouldDowngrade` predicate.
  - **R4.3** Orchestrator integration + `metadata @> ...::text[]` SQL filters on both canonical-chunk and representation scans of `SparseSearchService`.
  - **R4.4** Config wiring: `RAG_METADATA_PREFILTER_MODE` (fail-fast validated), `RAG_METADATA_HARD_FILTER_MIN_CONFIDENCE`, `RAG_METADATA_LLM_FALLBACK_ENABLED` (default off), `RAG_METADATA_LLM_TIMEOUT_MS`, `RAG_METADATA_LLM_CONCURRENCY`, `RAG_METADATA_MIN_CANDIDATES_BY_CLASS` (5-class default — `colloquial` intentionally absent). New `METADATA_ENTITY_LLM_CLIENT` provider (string token for parity with GOLDEN/REPRESENTATION clients).
  - **R4.5** Min-candidates guardrail: post-fusion count check, WARN log with tickers/issuerName body, `rag_metadata_prefilter_downgrade_total{query_class}` counter, one-shot re-run with hints stripped.
  - **Tech-debt entries** opened: `[RAG-TD-R4-01]` sectors/regions discarded by pre-filter; `[RAG-TD-R4-02]` `QueryClass` omits `colloquial` despite plan references; `[RAG-TD-R4-03]` dense lane silently ignores `tickers`/`issuerName`; `[RAG-TD-R4-04]` `issuerName` camelCase vs. snake_case metadata convention; `[RAG-TD-R4-05]` no GIN index on `document_chunks.metadata` (hot-path seq-scan risk).
  - **R4 eval-delta measurement deferred** same as R2.6/R3.6 — offline CorpusRetriever does not go through `SparseSearchService` or `QueryEntityExtractorService`, so bucket deltas stay speculative until the live-API CI workflow from R1.5's runbook ships.
- _(next entries per phase)_

## Final Outcome

_(Filled in after R7.7 ships.)_

---

## What Already Exists (Reuse Inventory)

Wave 2 is purely additive on top of `feat/rag-redesign`. The following are **already implemented and must be reused, not rebuilt**:

- **Schema & migrations** — V16 (`document_chunk_representations` with nullable `search_vector`, partial HNSW index, GIN index), V17 (`rag_query_logs` monthly-partitioned with retention cron).
- **Representation generation** — `ChunkRepresentationService.enrich()` emits 4 rep types per chunk with a 429 circuit breaker, concurrency cap, and `CURRENT_REPRESENTATION_VERSION` handling. Wave 2 only changes the `searchVector` field inside the existing insert.
- **Multi-stage retrieval scaffolding** — `RetrievalOrchestratorService`, `RetrievalFusionService` (RRF), `RerankService` (with bounded preamble + zod-validated response), `ContextExpanderService` (neighbor expansion gated by flag), all wired end-to-end.
- **Sparse lane** — `SparseSearchService` already joins `document_chunk_representations.search_vector`. Wave 2 adds weighted `ts_rank_cd` scoring on top; the SQL skeleton is already correct.
- **Planner** — `RetrievalPlannerService` has 4-class regex classifier, `query-variant.service.ts` has HyDE + decomposition, rewrite pathway. Wave 2 adds a 5th class (`exact_lookup`), a new `rerankQuery` field, and class-based rewrite gating.
- **Metadata pre-filter seam** — `MetadataPreFilterService` is deliberately a thin passthrough. Wave 2 fills the seam.
- **Evaluation runner** — strict/lenient recall, MRR, `minimum_metrics` gate, `compare_reports`, `TopKEvaluator`. Wave 2 adds per-bucket gating and the CI workflow.
- **CLI infrastructure** — `rag:golden:export`, `rag:backfill:representations`, `rag:repr:reindex`. Wave 2 adds `rag:backfill:representation-sparse` and `rag:reindex:by-doctype` as siblings.
- **Trace telemetry** — `RagTraceService` persists query plans, lane counts, timings, fallback flags, representation provenance. Wave 2's shadow comparisons reuse the same partitioning + retention pattern.
- **Graph enrichment contract** — `GraphEnrichConsumer` writes entities + chunk-entity links; relations are contract-only pending the Python sidecar. Wave 2 does NOT touch graph work.

## NOT in Scope

Each item below was considered and explicitly deferred:

- **GraphRAG default-on** — blocked on Python sidecar shipping the `relations` field; separate workstream, not Wave 2.
- **Missing middle / late-interaction / ColBERT** — deferred; Wave 2 must prove R2–R6 quality gains first before adding a more expensive middle layer.
- **Multimodal retrieval** (PDF page images via ColPali-style) — deferred; requires a different retrieval index and is premature before text-mode PDF ingestion settles.
- **Late chunking for very long documents** — deferred to post-Wave-2 targeted experiments on `long_doc` bucket if it remains the worst-performing bucket after R6.
- **Swapping vector store** (Qdrant, Weaviate, Nebula, Neo4j) — not justified; Postgres + pgvector + FTS meets requirements.
- **Swapping embedding provider** — not justified.
- **Desktop local RAG upgrade** — stays compatibility-only per T8 decision; `hybrid-search.ts` merging contract preserved.
- **Public chat SSE contract changes** — unchanged by Wave 2.
- **UI for golden-set labelling** — use the CLI + human reviewer workflow; UI is a future quality-of-life item.

## Parallelization Strategy

```
Lane A (sparse lane):         R2
Lane B (query → metadata):    R3 → R4
Lane C (ingest → chunking):   R5 → R6

R1 (eval gate) must land first (blocks all lanes from verifiable ship).
R7 (shadow/canary/default) merges all three lanes.
```

**Dependency table (module-level):**

| Step | Modules touched | Depends on |
|------|-----------------|------------|
| R1   | `services/evaluation-runner/`, `.github/workflows/` | — |
| R2   | `apps/api/src/rag/chunk-representation.service`, `apps/api/src/rag/sparse-search.service`, `apps/api/scripts/` | R1 |
| R3   | `apps/api/src/rag/retrieval-planner.service`, `apps/api/src/rag/retrieval-orchestrator.service`, `apps/api/src/rag/rag-retrieval.service`, `packages/shared/src/enums/` | R1 |
| R4   | `apps/api/src/rag/metadata-pre-filter.service`, `apps/api/src/rag/query-entity-extractor.service`, `apps/api/src/rag/retrieval-orchestrator.service`, `apps/api/src/config/` | R1, R3 |
| R5   | `apps/api/src/document/`, `services/parser/` (new), `docker-compose.yml`, `.github/workflows/` | R1 |
| R6   | `apps/api/src/document/document-chunking.service`, `apps/api/src/document/chunkers/`, `apps/api/src/config/` | R1, R5 |
| R7   | `apps/api/src/rag/rag-retrieval.service`, `apps/api/src/rag/rollout-gate.service`, `packages/db/migrations/V18__*`, `apps/api/src/config/`, `apps/api/src/rag/rag-trace.service` | R1, R2, R3, R4, R5, R6 |

**Conflict flags:**

- **Lane A vs Lane B overlap on `retrieval-orchestrator.service.ts`:** R2 modifies sparse-lane entry, R3–R4 modify planner → metadata pass-through. Rebase Lane A before Lane B's orchestrator edits to avoid manual merge.
- **Lane C internal conflict on `document-chunking.service.ts`:** R5 adds a PDF parser branch, R6 refactors the whole dispatch. Do NOT run R5 and R6 in parallel. R5 lands first, then R6 refactors on top.
- **R7 touches `rag-retrieval.service.ts` after R3 did.** Ensure R3 lands before R7 begins.

**Parallelization verdict:** Three lanes can run concurrently (A, B-front, C-front). Within each lane the steps are sequential. Full concurrency ceiling is ~3 parallel developer streams + R7 at the end.

## Plan Engineering Review

**Reviewer:** plan-eng-review skill (streamlined for Auto-mode), 2026-04-19.

**Scope challenge verdict:** PASS — Wave 2 is strictly additive over T1–T8. Each phase (R1–R7) ships as its own PR with ≤8 files modified. The 7-phase total is justified as planning-layer decomposition, not a single-PR blowup.

**Architecture review (6 findings, all P1/P2 addressed inline):**

1. **[P1] Anon canary hash** — fixed in R7.3: sessionId/IP fallback + anon percent multiplier.
2. **[P1] Shadow error capture** — fixed in R7.1: `multi_stage_error` column + explicit test.
3. **[P1] R3.5 caller audit** — fixed: plan now requires `grep` inventory before implementation.
4. **[P2] Parser sidecar distribution** — fixed in R5.4: Dockerfile, CI, compose, health endpoint required with stub.
5. **[P2] R4 LLM fallback cost** — fixed in R4.1: concurrency/timeout/circuit-breaker/master-flag guardrails added.
6. **[P3] Single-stage retirement** — fixed in R7.7: 30-day window, not 7-day.

**Code quality review (5 findings, 4 addressed inline):**

1. **[P1] R2.2 SQL injection risk** — fixed: parameterised `sql\`\`` pattern, never `sql.raw()` with user content.
2. **[P1] R3.1 ticker false positives** — fixed: whitelist required, explicit fallback if no whitelist exists.
3. **[P2] R6.1 chunking unit decision** — fixed: benchmark script required before decision.
4. **[P3] R4.5 per-class min threshold** — fixed: `RAG_METADATA_MIN_CANDIDATES_BY_CLASS`.
5. **[P3] R5.2 upload size cap** — fixed: `RAG_UPLOAD_MAX_BYTES`, reject before sidecar round-trip.

**Test review:** coverage diagram produced; 19 planned tests, 11 gaps identified, 2 regressions flagged (back-compat `.similarity` readers, HyDE override on exact_lookup). All gaps either addressed in the relevant phase or called out as required regression tests in this review.

**Performance review (3 findings):**

1. **[P2] Shadow-mode 2× cost** — `RAG_SHADOW_SAMPLE_RATE` added in R7.1.
2. **[P2] R4 hot-path LLM** — addressed by R4.1 guardrails above.
3. **[P3] R2.5 batch size** — default 500 added.

**Critical failure modes flagged:** 0 silent-failure paths remain after edits. Shadow errors, prefilter downgrades, parser failures, and rerank malformed responses all route to traced fallback paths with distinct flags.

**Completion summary:**

- Step 0 Scope Challenge: PASS (no scope reduction required)
- Architecture Review: 6 issues, all addressed
- Code Quality Review: 5 issues, all addressed
- Test Review: 11 gaps, all addressed (0 unresolved)
- Performance Review: 3 issues, all addressed
- NOT in scope: written (9 items)
- What already exists: written (10 reuse anchors)
- Parallelization: 3 lanes, 2 sequential chains within lanes, 1 capstone phase
- Unresolved decisions: 0 (all decisions either resolved inline or documented as "gating, decide during phase execution with evidence")
- Outside voice: skipped (Auto mode; user may invoke `/codex review` or `/plan-ceo-review` if desired)

**VERDICT:** ENG REVIEW CLEARED — plan is implementation-ready. Execute R1 first; R2, R3, R5 can fan out in parallel once R1 lands.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | ISSUES_FIXED | 15 findings; 6 critical (plan would not execute) + 9 HIGH/MED; all addressed inline; 2076158 tokens, session 019da7d9 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES_FIXED | 14 issues found across scope/arch/code/tests/perf; all P1+P2 addressed inline; 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**CODEX:** verified baseline facts (null searchVector, passthrough prefilter, char chunking, hardcoded similarity=1.0, etc.); forced 6 critical re-designs (parser target path, CLI flags, CI seed, tsvector config, rep backfill JOIN, R4 metadata prerequisite) before plan is implementation-ready.

**CROSS-MODEL:** high overlap on code-quality findings (tsvector safety, flag logic, caller audit); codex went deeper on repo-state verification (CLI args, schema columns, JS boolean trap). Claude eng-review went deeper on rollout mechanics (shadow sampling, canary stickiness). Complementary — together they covered both planning and verification dimensions.

**UNRESOLVED:** 0 hard blockers. Two deliberately deferred decisions (tokenizer vs char for R6, ticker whitelist source for R4.0) are scoped to phase-execution time with stated decision criteria.

**VERDICT:** ENG + CODEX CLEARED after inline fixes — ready to implement R1 (eval gate). No scope reduction needed; CRIT findings required plan redesign but did not invalidate the direction.

