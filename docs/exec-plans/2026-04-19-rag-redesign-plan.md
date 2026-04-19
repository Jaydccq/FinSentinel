# RAG Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move FinSentinel RAG from mostly single-pass chunk retrieval to an evaluation-gated, layered indexing and cascading retrieval system.

**Architecture:** Keep the current NestJS RAG module as the control plane, but split retrieval into explicit stages: query planning, metadata pre-filtering, multi-representation recall, RRF fusion, reranking, parent/section expansion, and trace logging. Ingestion becomes structure-aware and stores canonical chunks plus retrieval representations instead of treating raw chunk text as the only searchable surface.

**Tech Stack:** NestJS, Drizzle, PostgreSQL/pgvector/full-text search, BullMQ, FastAPI reranker sidecar, Python evaluation runner, Tauri/sqlite-vec for later local parity.

---

## Background

Current repository evidence:

- `apps/api/src/rag/rag-retrieval.service.ts` supports single-stage dense search by default and delegates to multi-stage retrieval only when `RAG_MULTI_STAGE_ENABLED=true`.
- `apps/api/src/rag/retrieval-orchestrator.service.ts`, `sparse-search.service.ts`, `retrieval-fusion.service.ts`, `rerank.service.ts`, and `context-packer.service.ts` already implement dense+sparse recall, RRF, rerank fallback, and context packing.
- `apps/api/src/rag/graph-retrieval.service.ts` exists, but graph activation depends on query cues and `RAG_GRAPH_ENABLED`.
- `apps/api/src/queue/graph-enrich.consumer.ts` extracts entities and links chunks, but it does not create relation rows in `knowledge_relations`.
- `apps/api/src/document/document-parse.service.ts` converts supported text-like files to cleaned plain text; PDF parsing intentionally returns empty text.
- `apps/api/src/document/document-upload.service.ts` rejects `application/pdf`, so the current cloud ingestion path cannot accept the PDF-heavy corpus described in the brief.
- `services/evaluation-runner` already has a golden-set runner and top-k metrics, but `services/evaluation-runner/datasets/golden.json` is synthetic and not wired into a CI gate.
- `apps/desktop` has a private local RAG path using Rust, sqlite-vec, and fastembed; it is intentionally not synced with cloud pgvector.

The user brief says current RAG quality is unstable because the retrieval surface is traditional, user questions and document prose have a large semantic gap, and indexing mistakes make answers unrecoverable. The brief also recommends layered indexing, cascading recall, strong reranking, and evaluation logs. External blog claims in the brief are treated as design inputs, not durable project facts; repository tests and evaluation results decide whether each phase ships.

## Goal

Build a staged redesign that makes retrieval quality measurable and improves recall before adding expensive GraphRAG, late chunking, or multimodal retrieval.

Success criteria:

- A representative golden set can run against the live API and fail CI on retrieval regressions.
- The cloud RAG index stores canonical chunks plus multiple retrieval representations: contextual text, generated sample questions, concise summary, keywords/entities, and structured metadata.
- The query planner can emit multiple query variants while preserving the original query as a fallback.
- Retrieval uses metadata pre-filtering, dense and sparse lanes, optional graph lane, RRF fusion, reranking, and parent/section expansion.
- Each query logs the plan, lane counts, returned chunk IDs, scores, timings, and fallback state so bad answers can become evaluation examples.
- Summary-based retrieval is used as a routing or coarse-filter signal, not as the only evidence surface.

## Scope

In scope:

- Cloud API RAG under `apps/api/src/rag`, `apps/api/src/document`, `apps/api/src/queue`, and `packages/db`.
- Evaluation runner upgrades under `services/evaluation-runner`.
- Reranker sidecar API additions only when needed for entity/relation extraction or rerank payload shape.
- Documentation for desktop local RAG parity after cloud schema and evaluation semantics settle.

Out of scope for the first implementation wave:

- Replacing PostgreSQL with Nebula, Neo4j, Qdrant, Weaviate, or another retrieval database.
- Applying multimodal/ColPali-style retrieval to the whole corpus.
- Building a UI for human golden-set labeling.
- Fully synchronizing desktop local private-doc embeddings with cloud RAG.
- Treating summary-only retrieval as the main retrieval path.

## Assumptions

- Use the evaluation-first path: baseline, then index improvements, then query planning, then graph/multimodal only if failure modes justify them.
- Existing `document_chunks` remains the canonical chunk table. New representation data should point back to canonical chunk IDs instead of duplicating source ownership.
- Existing `RerankService` remains an optional quality layer with timeout and fallback.
- PDF/Word conversion can start as an external preprocessing contract: upload or backfill consumes structure-preserving Markdown produced by tools such as mineru or ppocr. Direct sidecar orchestration can follow after the contract is tested.
- The first representative golden set should be assembled as 50-100 labeled examples: 30 recent real user queries from `chat_messages` and `agent_events` with high-frequency or low-recall signals, 20 synthetic-but-controlled queries reverse-constructed from `document_chunks` across doc type and sector coverage, and 20-30 hard boundary cases for abbreviations, years, numeric facts, cross-document relations, and long-tail entities.
- Golden-set labeling must include `expected_chunk_ids`, `acceptable_chunk_ids`, `query_class`, `difficulty`, and reviewer notes. The generator can propose candidate query/chunk pairs, but a human domain reviewer must approve labels before they become the regression gate.
- Cloud RAG is the primary redesign target. Desktop local RAG stays compatibility-only in this redesign wave because offline contextual representation generation is expensive and the reported semantic-gap pain is concentrated in the cloud knowledge base. The only desktop requirement is that `apps/web/src/lib/rag/hybrid-search.ts` can still merge upgraded cloud results with local sqlite-vec hits.

## Uncertainties

- The repository does not include real production query logs or a labeled private corpus.
- The embedding model dimension is delegated through `OpenRouterEmbeddingClient`; migrations and vector columns must preserve the existing dimension strategy.
- The runtime availability and licensing constraints for mineru, ppocr, or Word parsing are not encoded in the repo yet.
- Relation extraction quality is unknown because current graph enrichment only extracts entities.
- The real latency budget is unknown. Current code has Prometheus metrics but no representative RAG latency benchmark.

## Target Pipeline

```text
User query
  |
  v
RetrievalPlannerService
  +-- classify intent: factual | lexical | relational | analytical | yes_no | multimodal
  +-- infer filters from explicit request metadata only
  +-- generate query variants: original, rewrite, HyDE, subqueries
  |
  v
RetrievalOrchestratorService
  +-- metadata/title/summary pre-filter
  +-- dense lanes over contextual_text + sample_question representations
  +-- sparse lane over weighted full-text fields
  +-- optional graph lane for relation-heavy queries
  |
  v
RetrievalFusionService
  +-- RRF across lane + query-variant rankings
  |
  v
RerankService
  +-- cross-encoder sidecar if available
  +-- RRF fallback if unavailable
  |
  v
ContextPackerService
  +-- expand parent section / neighbor chunks
  +-- dedupe, enforce source diversity, enforce token budget
  |
  v
LLM answer generation
  |
  v
Groundedness / citation checks
  |
  v
RagTraceService logs query plan, scores, chunk IDs, timings, and failures
```

## Target Data Model

Keep `document_chunks` as the canonical source of retrieved evidence:

```ts
interface CanonicalChunk {
  id: string;
  sourceType: 'document' | 'news';
  sourceId: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  metaTitle: string | null;
  metaSource: string | null;
  metaEntities: string | null;
  searchVector: string | null;
}
```

Add a representation table so multiple searchable surfaces can map to one canonical chunk:

```ts
type ChunkRepresentationType =
  | 'contextual_text'
  | 'sample_question'
  | 'summary'
  | 'keyword_entity';

interface DocumentChunkRepresentation {
  id: string;
  chunkId: string;
  representationType: ChunkRepresentationType;
  content: string;
  embedding: number[] | null;
  searchVector: string | null;
  weight: number;
  metadata: {
    section_path?: string;
    title?: string;
    keywords?: string[];
    entities?: string[];
    modality?: 'text' | 'table' | 'image' | 'pdf_page';
    index_version: string;
  };
}
```

Add query trace storage for evaluation and debugging:

```ts
interface RagQueryLog {
  id: string;
  userId: string | null;
  query: string;
  queryClass: string;
  queryVariants: string[];
  filters: Record<string, unknown>;
  lanes: string[];
  resultChunkIds: string[];
  timingsMs: Record<string, number>;
  fallbackFlags: string[];
  createdAt: Date;
}
```

## Implementation Steps

### Task 1: Make Retrieval Evaluation The Gate

**Files:**

- Modify: `services/evaluation-runner/run_evaluation.py`
- Modify: `services/evaluation-runner/evaluators/topk_evaluator.py`
- Modify: `services/evaluation-runner/configs/baseline.yaml`
- Create: `services/evaluation-runner/configs/cloud-multistage.yaml`
- Create: `services/evaluation-runner/reports/.gitkeep`
- Modify: `apps/api/src/rag/rag-retrieval.service.ts`
- Test: `services/evaluation-runner/evaluators/test_topk_evaluator.py`
- Test: `apps/api/src/rag/__tests__/rag-retrieval.service.spec.ts`

**Step order is load-bearing: stable chunk IDs must land before evaluator work, or the evaluator cannot identify what it's scoring.**

- [ ] **(Step 1, do first)** Return stable `chunkId` values from the API retrieval path. `RagSearchResult` should include `chunkId` and `sourceId` in addition to `content`, `metadata`, and score so the evaluator does not rely on metadata guesses. Applies to BOTH the single-stage dense path and the multi-stage path, and to all fallback paths.

Verify: `pnpm --filter @finsentinel/api test -- src/rag/__tests__/rag-retrieval.service.spec.ts` — test asserts chunkId is present on single-stage results, multi-stage results, and reranker-fallback results.

- [ ] **(Step 2)** Add a dedicated regression test that freezes current dense-only top-10 output with `RAG_MULTI_STAGE_ENABLED=false`. Any later orchestrator change must keep this test green.

Verify: `pnpm --filter @finsentinel/api test -- src/rag/__tests__/rag-retrieval-flag-off.regression.spec.ts`

- [x] **(Step 3)** Extend the golden-set schema to support both required and acceptable matches:

```json
{
  "id": "gs-real-001",
  "query": "What drove Apple's services growth?",
  "query_class": "factoid",
  "expected_chunk_ids": ["chunk-required-1"],
  "acceptable_chunk_ids": ["chunk-nearby-1", "chunk-parent-section-1"],
  "expected_source_docs": ["AAPL-10K-2025.pdf"],
  "expected_answer": "Human-reviewed expected answer summary.",
  "expected_entities": ["Apple Inc."],
  "difficulty": "medium",
  "tags": ["services", "growth"],
  "notes": "Required chunk contains the exact metric; acceptable chunks contain the same section context."
}
```

Verify: evaluator tests show `expected_chunk_ids` drive strict recall and `acceptable_chunk_ids` drive a separate lenient recall metric without hiding strict misses.

- [x] **(Step 4)** Add support for `minimum_metrics` in evaluation config:

```yaml
retrieval:
  endpoint: "/api/rag/search"
  top_k: 10
minimum_metrics:
  recall@5: 0.65
  mrr@10: 0.55
```

- [x] **(Step 5)** Update `compare_reports` and `run_evaluation` so an experiment fails when configured minimum metrics are not met.

Verify: `python services/evaluation-runner/run_evaluation.py run --dataset services/evaluation-runner/datasets/golden.json --output services/evaluation-runner/reports/offline.json --corpus services/evaluation-runner/datasets/corpus.json`

- [ ] **(Step 6)** Add a golden-set candidate export command that proposes 50-100 review candidates from three sources: recent real user prompts in `chat_messages`, relevant retrieval or analysis payloads in `agent_events`, and reverse-constructed chunk questions from `document_chunks`.

Verify: generated draft JSON includes source provenance and is written as a draft file, not over `services/evaluation-runner/datasets/golden.json`.

- [ ] **(Step 7)** Add a golden-set maintenance note to the plan progress log whenever synthetic data is replaced with real labeled examples.

Verify: `python services/evaluation-runner/run_evaluation.py compare services/evaluation-runner/reports/baseline.json services/evaluation-runner/reports/offline.json` fails on regressions and passes on non-regression.

### Task 2: Introduce Multi-Representation Chunk Indexing

**Files:**

- Create: `packages/db/migrations/V16__add_rag_chunk_representations.sql`
- Create: `packages/db/src/schema/document-chunk-representations.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `apps/api/src/rag/rag-chunk-store.service.ts`
- Create: `apps/api/src/rag/chunk-representation.service.ts`
- Modify: `apps/api/src/document/document-vector.service.ts`
- Test: `apps/api/src/rag/__tests__/chunk-representation.service.spec.ts`
- Test: `apps/api/src/rag/__tests__/rag-chunk-store.service.spec.ts`

- [ ] Add `document_chunk_representations` with `chunk_id` (FK, ON DELETE CASCADE), `representation_type`, `content`, nullable `embedding`, nullable `search_vector`, `weight`, `metadata` (incl. `index_version`), and timestamps. Add a **partial HNSW index** on `embedding` WHERE `representation_type IN ('contextual_text','sample_question')` — summary and keyword rows do not need vector search. The migration must include a commented `-- ROLLBACK:` block with the matching `DROP INDEX` / `DROP TABLE` sequence so a failed backfill is recoverable.

Verify: `pnpm --filter @finsentinel/db test -- src/__tests__/apply-migrations.test.ts` — test asserts the rollback block parses as valid SQL on a scratch DB.

- [ ] **All inserts into `document_chunk_representations` must set every column explicitly** per `CLAUDE.md` (Drizzle 0.44.x + postgres.js 3.4.9 mixed-default bug). Reference pattern: `apps/api/src/analysis/analysis-checkpoint.service.ts:40-52`. Or use raw SQL via `this.db.execute(sql\`…\`)`.

Verify: a unit test constructs a minimal insert and asserts all column names appear in the generated SQL.

- [ ] Generate four representations per canonical chunk:

```text
contextual_text = title + section_path + one-sentence local context + chunk_text
sample_question = 1-3 likely user questions this chunk can answer
summary = one-sentence chunk summary
keyword_entity = keywords + entity names + ticker aliases
```

- [ ] Embed `contextual_text` and `sample_question` representations. Keep summary searchable by sparse/metadata first unless evaluation proves summary dense retrieval helps.

Verify: `pnpm --filter @finsentinel/api test -- src/rag/__tests__/chunk-representation.service.spec.ts`

- [ ] **Cost and rate-limit guardrails.** Enrichment consumer must respect:
  - `RAG_REPRESENTATION_CONCURRENCY` (default 4)
  - `RAG_REPRESENTATION_BATCH_SIZE` (default 50)
  - `RAG_REPRESENTATION_MAX_CHUNKS_PER_DOC` (default 2000; docs above cap emit a structured warning and enrich only the first N)
  - Circuit breaker: halt enrichment after 5 consecutive OpenRouter 429s, resume with exponential backoff.
  - Chunks whose base canonical embedding already exists must remain retrievable via the base embedding + sparse lane if representation generation fails.

Verify: unit tests cover concurrency cap, 429 circuit breaker, per-doc cap, and degraded-retrieval-works path. A benchmark test against a 1000-chunk fixture logs wall time and estimated OpenRouter token count.

- [ ] **Index versioning.** `chunk-representation.service.ts` exports a `CURRENT_REPRESENTATION_VERSION` constant (semver, e.g. `"rep-v1.0"`). Every generated row writes `metadata.index_version`. Retrieval reads only the highest-version row per `(chunk_id, representation_type)`; lower-version rows are kept, not deleted, for rollback. Add a CLI `pnpm --filter @finsentinel/api rag:repr:reindex --from-version <v>` that enqueues chunks whose current version is below the target.

Verify: test covers (a) retrieval prefers highest version; (b) enrichment is a no-op when current version already matches; (c) CLI emits correct enqueue count on a fixture corpus.

- [ ] **Backfill for existing corpus.** Standalone script `apps/api/scripts/rag-backfill-representations.ts` (or CLI equivalent) walks existing `document_chunks` in source-id batches and enqueues onto the enrichment stream. Respects the guardrails above. Dry-run mode prints estimated cost + row count without enqueuing.

Verify: dry-run on local DB reports matching chunk count against `SELECT count(*) FROM document_chunks`; wet run on a 50-chunk fixture produces 50 × expected representation rows.

- [ ] Update `RagChunkStoreService.replaceChunks` to replace canonical chunks and representation rows in one logical operation.

Verify: a vectorization unit test proves reindexing the same document removes stale representation rows.

### Task 3: Upgrade Parsing And Chunk Boundaries Without Big-Bang OCR

**Files:**

- Modify: `apps/api/src/document/document-upload.service.ts`
- Modify: `apps/api/src/document/document-parse.service.ts`
- Modify: `apps/api/src/document/document-chunking.service.ts`
- Create: `apps/api/src/document/structured-document.ts`
- Create: `apps/api/src/document/markdown-structure.service.ts`
- Test: `apps/api/src/document/__tests__/document-upload.service.spec.ts`
- Test: `apps/api/src/document/__tests__/document-parse.service.spec.ts`
- Test: `apps/api/src/document/__tests__/document-chunking.service.spec.ts`

- [ ] Allow `text/markdown` and structure-preserving Markdown as the first-class ingestion contract for OCR/PDF/Word conversions.

Verify: upload tests accept `.md` and preserve title/heading metadata.

- [ ] Add PDF/Word as accepted MIME types only after a parser or sidecar contract returns non-empty Markdown with page and section metadata. Until then, keep rejection explicit and documented.

Verify: PDF upload tests assert the exact rejection reason points to the Markdown preprocessing contract.

- [ ] Replace flat chunk output with structured chunks:

```ts
interface StructuredChunk {
  text: string;
  title: string | null;
  sectionPath: string[];
  parentId: string | null;
  modality: 'text' | 'table' | 'image' | 'pdf_page';
  pageStart: number | null;
  pageEnd: number | null;
}
```

Verify: chunking tests cover heading boundaries, paragraph fallback, short-section merge, and overlap.

### Task 4: Expand Query Planning Into Variant Generation

**Files:**

- Modify: `apps/api/src/rag/retrieval-planner.service.ts`
- Modify: `apps/api/src/rag/query-rewrite.service.ts`
- Create: `apps/api/src/rag/query-variant.service.ts`
- Modify: `apps/api/src/config/rag.config.ts`
- Test: `apps/api/src/rag/__tests__/retrieval-planner.service.spec.ts`
- Test: `apps/api/src/rag/__tests__/query-rewrite.service.spec.ts`
- Test: `apps/api/src/rag/__tests__/query-variant.service.spec.ts`

- [ ] Extend `RetrievalPlan` to include `queryClass`, `filters`, `variants`, and `enabledLanes`.

Verify: existing planner tests still prove dense+sparse are default lanes.

- [ ] Implement conservative query variants:

```text
original: always present
rewrite: enabled by current query rewrite flag
hyde: enabled only for analytical/multi-hop queries and length-bounded
subqueries: enabled only when planner detects multi-part questions
```

Verify: tests cover empty query, simple factual query, relational query, analytical query, and LLM failure fallback.

- [ ] Never drop the original query. If rewrite/HyDE fails, the plan remains executable with original dense+sparse lanes.

Verify: tests assert fallback flags are present but no exception escapes planning.

### Task 5: Make Retrieval Cascading And Representation-Aware

**Files:**

- Modify: `apps/api/src/rag/retrieval-orchestrator.service.ts`
- Modify: `apps/api/src/rag/retrieval-fusion.service.ts`
- Modify: `apps/api/src/rag/sparse-search.service.ts`
- Modify: `apps/api/src/rag/rag-chunk-store.service.ts`
- Modify: `apps/api/src/rag/rerank.service.ts`
- Modify: `apps/api/src/rag/context-packer.service.ts`
- Test: `apps/api/src/rag/__tests__/retrieval-orchestrator.service.spec.ts`
- Test: `apps/api/src/rag/__tests__/retrieval-fusion.service.spec.ts`
- Test: `apps/api/src/rag/__tests__/sparse-search.service.spec.ts`
- Test: `apps/api/src/rag/__tests__/rerank.service.spec.ts`
- Test: `apps/api/src/rag/__tests__/context-packer.service.spec.ts`

- [ ] Add a pre-filter step that uses explicit request filters plus indexed title, doc type, sector, region, date, entities, and summary fields.

Verify: SQL tests assert filters are composed with `AND` and never inferred from ambiguous query text alone.

- [ ] Search dense representations across `contextual_text` and `sample_question`; search sparse representations across canonical content, title/source/entities, and keyword/entity representation.

Verify: orchestrator tests show a single canonical chunk can be found by both contextual and sample-question lanes, then deduped after RRF.

- [ ] Extend RRF input identity to preserve lane and query variant while fusing by canonical `chunkId`.

Verify: fusion tests cover duplicates across lanes and variants.

- [ ] Rerank canonical chunk text with contextual metadata prepended, then pack canonical text plus section path for answer grounding.

  **Truncation strategy (load-bearing):** BGE cross-encoder has a fixed max input length (typically 512 tokens). Payload construction must bound total length and, when over budget, **drop the preamble first, never the chunk evidence**. Token count is estimated via a lightweight tokenizer approximation; exact character/token limits live in config (`RAG_RERANK_MAX_TOKENS`, default 480 to leave headroom).

  **Defensive response parsing:** reranker sidecar response must be validated against a zod schema. A 200 OK with unexpected shape is treated as a sidecar fault, triggers the RRF fallback path, and is recorded as a distinct fallback flag (`rerank_malformed` vs `rerank_unavailable`).

Verify: rerank tests cover (a) payload contains evidence text and title/section preamble under budget; (b) when total would exceed `RAG_RERANK_MAX_TOKENS`, preamble is truncated/dropped and chunk evidence is preserved; (c) malformed JSON → RRF fallback path + `rerank_malformed` flag; (d) sidecar 5xx → same fallback + `rerank_unavailable` flag.

- [ ] Expand parent/section context after rerank, not before. Fetch neighbor chunks by `sourceId`, `sectionPath`, and `chunkIndex` only for top reranked candidates.

Verify: context packer tests cover token budget, source diversity, dedupe, and neighbor expansion.

### Task 6: Add Query Trace Logging And Failure Mining

**Files:**

- Create: `packages/db/migrations/V17__add_rag_query_logs.sql`
- Create: `packages/db/src/schema/rag-query-logs.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `apps/api/src/rag/rag-trace.service.ts`
- Modify: `apps/api/src/rag/rag-retrieval.service.ts`
- Modify: `services/evaluation-runner/run_evaluation.py`
- Test: `apps/api/src/rag/__tests__/rag-trace.service.spec.ts`
- Test: `apps/api/src/rag/__tests__/rag-retrieval.service.spec.ts`

- [ ] Log every multi-stage query with query class, variants, lanes, candidate counts, result chunk IDs, timings, and fallback flags.

  **Storage discipline (production traffic will be high):**
  - `V17__add_rag_query_logs.sql` creates the table **partitioned by `created_at` (monthly range partitions)** with a default partition for safety, plus an initial partition for the current month.
  - Add a retention job (cron or startup-registered `@nestjs/schedule` tick) that drops partitions older than `RAG_QUERY_LOG_RETENTION_DAYS` (default 30).
  - Add a sampling knob: when `RAG_QUERY_LOG_SAMPLE_RATE` < 1.0, non-fallback queries are sampled at the configured rate; **all fallback/error paths are always logged** so failure mining stays complete.
  - The migration must include a commented `-- ROLLBACK:` block matching the partition and index creation order.
  - PII: queries may contain user names, account IDs, or tickers that identify a portfolio. Log the raw query only when `RAG_QUERY_LOG_PII_ENABLED=true` (staging/dev); otherwise log a SHA-256 hash of the query plus class + length.
  - Alternative considered and deferred: route trace writes through the existing append-only `agent_events` log with `aggregate_type='RAG_QUERY'` to inherit retention and replay tooling. Revisit if the trace table's storage or query complexity outgrows its purpose.

- [ ] **All inserts into `rag_query_logs` must set every column explicitly** per `CLAUDE.md` (Drizzle/postgres.js mixed-default bug). Same convention as `document_chunk_representations`.

Verify: retrieval tests assert successful and fallback paths both emit traces; a separate test asserts (a) sampled-out queries still log when they carry any fallback flag; (b) default PII mode stores hashed query, not raw text.

- [ ] Add an evaluation-runner command that can export low-confidence or no-result query logs into a labeling draft format.

Verify: a unit test converts sample logs into golden-set candidate JSON without mutating the canonical golden file.

### Task 7: Gate GraphRAG Behind Relation Quality

**Files:**

- Modify: `apps/api/src/queue/graph-enrich.consumer.ts`
- Modify: `services/reranker/routers/entities.py`
- Modify: `apps/api/src/rag/graph-retrieval.service.ts`
- Modify: `apps/api/src/rag/retrieval-planner.service.ts`
- Test: `apps/api/src/queue/__tests__/graph-enrich.consumer.spec.ts`
- Test: `apps/api/src/rag/__tests__/graph-retrieval.service.spec.ts`

- [ ] Extend enrichment to produce relation candidates with evidence chunk IDs. Persist only relation rows that have source entity, target entity, relation type, confidence, and source chunk evidence.

Verify: graph enrichment test proves entity-only output does not create relation rows.

- [ ] Activate graph lane only for relational/multi-hop query classes and only when matching entities exist.

Verify: planner and graph retrieval tests prove simple factual queries do not pay graph cost.

- [ ] Compare relational subset metrics before enabling `RAG_GRAPH_ENABLED` by default.

Verify: `python services/evaluation-runner/run_evaluation.py compare reports/multirep.json reports/graph.json` shows no regression in overall recall and improvement on relational tags.

### Task 8: Document Desktop Local RAG Parity Plan

**Files:**

- Modify: `apps/desktop/README.md`
- Create: `docs/exec-plans/2026-04-19-desktop-rag-parity-notes.md`

- [ ] Document that desktop local RAG remains private, local-first, and compatibility-only for this cloud RAG redesign wave.

Verify: no code changes in `apps/desktop/src-tauri` for this cloud redesign wave.

- [ ] List local-only constraints: fastembed model, sqlite-vec single-file DB, no network parsing, no cloud sync, no sidecar dependency.

Verify: documentation points to cloud plan and explains why local parity is deferred.

- [ ] Add or keep a web unit test proving `hybridSearch` still merges upgraded cloud results with local `SearchHit` results using stable IDs and scores.

Verify: `pnpm --filter @finsentinel/web test -- src/lib/rag/__tests__/hybrid-search.test.ts`

## Verification Approach

Targeted commands:

```bash
pnpm --filter @finsentinel/api test -- src/rag
pnpm --filter @finsentinel/api test -- src/document
pnpm --filter @finsentinel/api test -- src/queue/__tests__/graph-enrich.consumer.spec.ts
pnpm --filter @finsentinel/db test
python services/evaluation-runner/run_evaluation.py run --dataset services/evaluation-runner/datasets/golden.json --output services/evaluation-runner/reports/baseline.json --config services/evaluation-runner/configs/baseline.yaml
python services/evaluation-runner/run_evaluation.py compare services/evaluation-runner/reports/baseline.json services/evaluation-runner/reports/experiment.json
pnpm typecheck
```

Acceptance checks:

- Retrieval reports include `recall@3`, `recall@5`, `recall@10`, `precision@k`, and `mrr@k`, reported separately as strict (`expected_chunk_ids` only) and lenient (`expected ∪ acceptable`).
- `RagSearchResult` exposes stable `chunkId` + `sourceId` on single-stage, multi-stage, and all fallback paths.
- Flag-off regression test locks current dense-only top-10 output.
- Reindexing a document replaces stale canonical chunks and stale representation rows.
- Representation generation respects concurrency/batch/per-doc caps and the 429 circuit breaker; degraded enrichment leaves base retrieval working.
- `CURRENT_REPRESENTATION_VERSION` is written on every row; retrieval reads highest-version; downgrade CLI re-enqueues stale rows.
- Every new migration file includes a `-- ROLLBACK:` block validated against a scratch DB.
- Query planning never requires LLM success to search.
- Reranker outage returns RRF-ranked results with `rerank_unavailable`; malformed response returns RRF-ranked results with `rerank_malformed`.
- Rerank payload never drops chunk evidence due to length; preamble is truncated first.
- `rag_query_logs` writes respect sampling; fallback-flagged queries are always logged; raw query text is hashed unless `RAG_QUERY_LOG_PII_ENABLED=true`; retention job drops partitions older than `RAG_QUERY_LOG_RETENTION_DAYS`.
- Graph lane is opt-in by query class and feature flag; default-on requires classifier precision ≥ 0.85 on the relational class AND no regression in overall recall.

New env vars introduced by this plan:

- `RAG_REPRESENTATION_CONCURRENCY` (default 4)
- `RAG_REPRESENTATION_BATCH_SIZE` (default 50)
- `RAG_REPRESENTATION_MAX_CHUNKS_PER_DOC` (default 2000)
- `RAG_RERANK_MAX_TOKENS` (default 480)
- `RAG_QUERY_LOG_SAMPLE_RATE` (default 1.0)
- `RAG_QUERY_LOG_RETENTION_DAYS` (default 30)
- `RAG_QUERY_LOG_PII_ENABLED` (default false)

Known verification caveat:

- Workspace-wide `pnpm typecheck` is currently blocked by a pre-existing `packages/db` build config issue recorded in `docs/exec-plans/tech-debt-tracker.md`. Use narrower package checks until that debt is resolved.
- `python3 services/evaluation-runner/run_evaluation.py ...` currently requires the Python dependencies from `services/evaluation-runner/requirements.txt`; this local environment is missing `pyyaml`.

## Progress Log

- 2026-04-19: Read current RAG, document ingestion, graph enrichment, desktop local RAG, evaluation-runner, and existing technical docs.
- 2026-04-19: Selected the evaluation-first phased redesign because existing multi-stage retrieval already exists but lacks representative gates and richer indexing.
- 2026-04-19: Added this execution plan. No production code changed.
- 2026-04-19: Verified markdown structure and `git diff --check`; attempted offline evaluation runner, but it failed before execution with `ModuleNotFoundError: No module named 'yaml'`.
- 2026-04-19: Chose desktop compatibility-only scope for this wave and accepted the mixed real/synthetic/hard-case golden-set seeding protocol.

## Key Decisions

- Use summary as a top-level routing/coarse-filter representation, not the only retrieval surface.
- Keep PostgreSQL/pgvector/full-text search for the primary cloud path; do not add a new retrieval database before metrics show a need.
- Add representation rows instead of overloading `document_chunks.embedding` with several meanings.
- Keep original query in every plan to make query rewrite and HyDE reversible.
- Expand parent/section context after rerank to avoid sending too much weak context into expensive stages.
- Defer full multimodal and late chunking to targeted subsets after baseline failure analysis.
- Keep desktop local RAG compatibility-only in this wave; do not add multi-representation sqlite-vec indexing until cloud RAG proves the representation contract and metrics.
- Seed golden sets from `chat_messages`, `agent_events`, controlled `document_chunks` reverse queries, and hard boundary cases; require human review before a generated candidate becomes a gate.

## Risks And Blockers

- Real golden labels are missing. Without them, tuning can optimize against synthetic examples.
- PDF/Word OCR tooling is not encoded in repository dependencies or deployment docs.
- LLM-generated contextual text, sample questions, summaries, and HyDE can add cost and nondeterminism. Addressed by Task 2 concurrency, batch, and per-doc caps, the 429 circuit breaker, and explicit `CURRENT_REPRESENTATION_VERSION` handling.
- New representation table increases storage and backfill time. Addressed by Task 2 partial HNSW index (only `contextual_text` + `sample_question` rows get vector index), dry-run backfill CLI, and per-doc chunk cap.
- Graph relation extraction can create false confidence if relation evidence is weak. Addressed by Task 7 evidence + confidence requirements and the classifier-precision gate before defaulting the graph lane on.
- Reranker sidecar latency may dominate query time if candidate counts are not bounded. Addressed by explicit pre-rerank candidate caps in Task 5.
- Rerank sidecar input truncation can silently degrade quality when preamble + chunk exceed BGE max length. Addressed by Task 5 token-budget config and preamble-first truncation.
- Reranker sidecar returning a 200 OK with unexpected payload shape was a silent failure before; now parsed defensively and routed to RRF fallback with a distinct `rerank_malformed` flag.
- `rag_query_logs` volume under production traffic. Addressed by Task 6 monthly partitioning, retention job, sampling knob (fallbacks always sampled), and PII hashing by default.
- Postgres driver insert bug (Drizzle 0.44.x + postgres.js 3.4.9, see `CLAUDE.md`) on new tables. Addressed by the explicit every-column-insert convention referenced in Tasks 2 and 6.

## Plan Engineering Review

Scope challenge:

- Existing code already solves dense recall, sparse recall, RRF, reranker fallback, context packing, graph skeleton, queue-based ingestion, and top-k evaluation. The plan reuses those components.
- The minimum complete path is Tasks 1 through 6. Tasks 7 and 8 are gated follow-ups.
- The plan touches more than eight files because RAG crosses DB schema, ingestion, retrieval, sidecar, and evaluation. This is justified as a multi-phase plan; implementation should land task by task, not as one PR.
- There is no `TODOS.md` in the repo. Existing RAG gaps belong in this plan and the technical debt tracker.

Architecture review:

- Recommendation: Do not replace PostgreSQL or add a graph database yet. The repository already has pgvector, full-text search, and relation tables; use them until relational evaluation proves they are inadequate.
- Recommendation: Keep representation indexing as an additive table. It lowers rollback risk because canonical chunks and existing retrieval can still work if representation search is disabled.
- Recommendation: Put PDF/Word OCR behind a Markdown contract first. Directly embedding mineru/ppocr orchestration into the upload path would couple slow, tool-specific parsing to API availability.

Code-quality review:

- Recommendation: avoid a single large "advanced retrieval service." Keep planning, representation generation, recall, fusion, rerank, packing, and trace logging as separate services because those boundaries already exist.
- Recommendation: keep feature flags for multi-stage, HyDE, graph, representation dense lanes, and trace logging. Each flag must have a tested fallback path.
- Recommendation: encode repeated retrieval constraints mechanically through tests, migrations, and config schemas instead of adding prose-only rules.

Test review:

```text
Upload/backfill
  -> parse/structure
  -> chunk
  -> representations
  -> embeddings
  -> canonical + representation persistence
  -> eval-visible chunk IDs

Query
  -> planner variants
  -> pre-filter
  -> dense/sparse/graph recall
  -> RRF fusion
  -> rerank fallback
  -> context expansion
  -> trace log
```

Every arrow above needs happy-path, empty-input, failure, and fallback tests. Evaluation-runner comparisons are required before enabling any new lane by default.

Performance review:

- Bound candidate counts per lane and per query variant.
- Avoid parent/section expansion before rerank.
- Keep graph and multimodal lanes disabled by default until subset metrics justify cost.
- Trace timing per stage so latency regressions are attributable.

## Final Outcome

Planning complete. No implementation has been applied yet. The next correct action is Task 1, Step 1: expose stable `chunkId`/`sourceId` on `RagSearchResult` across single-stage, multi-stage, and fallback paths. Without stable chunk IDs the evaluator cannot score anything that follows.

### Progress Log

**2026-04-19 — T1.A done** (prior session): stable `chunkId`/`sourceId` returned from API; flag-off regression test added.

**2026-04-19 — T1.B done**: strict/lenient recall split + `minimum_metrics` gate implemented.
- `GoldenEntry.acceptable_chunk_ids` added (optional, default empty).
- `TopKEvaluator.evaluate()` now returns `strict.*` and `lenient.*` namespaces for recall and MRR; precision kept strict-only.
- `check_minimum_metrics()` helper factored out of `run_evaluation.py` for testability.
- `run_evaluation` writes report first, then enforces thresholds and exits 1 on any violation.
- `compare_reports` also enforces `minimum_metrics` recorded in the experiment report.
- `configs/baseline.yaml` has conservative thresholds (30/45/60/25 for strict.recall@5/10, lenient.recall@10, strict.mrr@10).
- `configs/cloud-multistage.yaml` created with Phase-2 targets from design spec §2.
- `datasets/golden.json` backfilled with `acceptable_chunk_ids: []` on all 25 entries.
- 23 tests pass (17 topk + 9 run_evaluation + 1 ragas).
- Smoke run with corpus confirms all baseline thresholds pass (actual: strict.recall@10 = 1.00).
- `evaluators/conftest.py` added to fix pre-existing test import path issue (bare imports need path fixture).

Next: T1.C — golden set candidate export CLI.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES_FIXED | 12 issues surfaced (3 P0, 6 P1, 3 P2); 4 critical failure-mode gaps; all addressed via targeted edits to Tasks 1, 2, 5, 6 + Risks + Acceptance |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**VERDICT:** ENG REVIEW CLEARED — structural issues resolved, scope unchanged, ready to implement Task 1 Step 1.

**2026-04-19 — T3 done**: heading-aware chunking + structured document ingestion.
- Created `apps/api/src/document/structured-document.ts` with `StructuredChunk` and `StructuredDocument` interfaces.
- Created `apps/api/src/document/markdown-structure.service.ts`: regex-based ATX heading parser (levels 1-6), setext headings (H1/H2), fenced code blocks (verbatim, modality 'text'), table detection (requires separator row, modality 'table'), paragraph blocks (modality 'text'). Section stack pops correctly on shallower headings. pageStart/pageEnd always null. parentId null at parse time.
- Added `DocumentChunkingService.chunkStructured(doc)`: tables and non-text blocks emitted as-is (truncated at 4x chunkSize with note); text blocks split on paragraph/sentence/word boundaries inheriting parent sectionPath + title + modality. minChunkSizeChars and maxNumChunks caps honored. Legacy `chunk(text)` signature unchanged.
- Modified `DocumentVectorService.vectorize()` to call `MarkdownStructureService.parse()` + `chunking.chunkStructured()`, then passes `sectionPath` (joined with " / ") and `title` to `RagChunkStoreService.replaceChunks`.
- Modified `RagChunkStoreService.replaceChunks` to accept optional `sectionPath` and `title` per chunk and write them to the existing `section_path` / `meta_title` columns.
- Provided and exported `MarkdownStructureService` in `DocumentModule`.
- Tests: 133 test files pass, 1098 tests pass. Typecheck clean.
- Commit: `1f63e45`.

**2026-04-19 — T4 done**: query variant planner with HyDE + decomposition.
- Created `apps/api/src/rag/query-variant.service.ts`: three methods — `rewrite()` (delegates to `QueryRewriteService`), `hyde()` (returns trimmed hypothetical passage capped at 400 chars or null on failure), `decompose()` (parses zod-validated JSON array of 0-3 subqueries, returns [] on failure). Both LLM methods degrade gracefully and log warn on failure, never throw.
- Modified `apps/api/src/rag/retrieval-planner.service.ts`: added `QueryClass` (`factoid | relational | analytical | multi_part`), `VariantKind`, `QueryVariant`, and extended `RetrievalPlan` with `queryClass`, `variants[]`, and `fallbackFlags[]`. Kept `rewrittenQuery` for T5 backward compat. Regex classifier (no LLM): `multi_part` (multiple `?` or `and` adjacent to `?`) > `analytical` (length > 120 OR analytical keywords) > `relational` (existing cues) > `factoid`. Activation: analytical + `RAG_HYDE_ENABLED` triggers hyde; multi_part + `RAG_QUERY_DECOMPOSE_ENABLED` triggers decompose. Graph lane activation consolidated under relational class path.
- Modified `apps/api/src/config/rag.config.ts`: added `hydeEnabled` (default false) and `queryDecomposeEnabled` (default false) under `retrieval`.
- Modified `apps/api/src/rag/rag.module.ts`: registered and exported `QueryVariantService`.
- Tests: created `query-variant.service.spec.ts` (9 tests), expanded `retrieval-planner.service.spec.ts` (24 tests). All 134 test files, 1126 tests pass. Typecheck clean.
- Commit: `e42c2ae`.
