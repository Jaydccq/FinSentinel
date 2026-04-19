# RAG System Redesign — Evaluation-First, Phased Upgrade

- **Date**: 2026-04-19
- **Owner**: @HongxiChen
- **Status**: Draft — pending user review
- **Related**: `docs/plans/2026-04-06-rag-engineering-upgrade.md` (predecessor), `apps/api/src/rag/`, `apps/api/src/document/`

## 1. Background

FinSentinel's RAG pipeline is partially deployed. The multi-stage retrieval stack (dense + BM25 + RRF + cross-encoder rerank + context packing) exists under `apps/api/src/rag/` but is gated behind `RAG_MULTI_STAGE_ENABLED=false`. The GraphRAG schema (`knowledge_entities`, `knowledge_relations`, `chunk_entity_links`) is migrated but no enrichment pipeline writes to it. There is no golden set, no recall/MRR measurement, and no offline evaluation runner. Document ingestion uses hierarchical character-boundary chunking with a single dense embedding per chunk — no structure-preserving parsing, no multi-representation indexing, no metadata auto-extraction.

Users report low retrieval quality. The root cause hypothesis, supported by Anthropic's Contextual Retrieval work, Microsoft's Advanced RAG guidance, and Databricks' ingestion playbook, is a **semantic gap**: user queries are colloquial and short, while KB chunks are formal prose without query-aligned representations. A single dense embedding of raw chunk text cannot close that gap.

## 2. Goal

Raise retrieval quality on a measurable golden set such that:

- **Strict recall@10 ≥ 0.75** (must-hit `expected_chunk_ids`) on the mixed 50–100-query golden set by end of Phase 2.
- **Lenient recall@10 ≥ 0.88** (must-hit OR `acceptable_chunk_ids`) by end of Phase 2.
- **MRR@10 ≥ 0.55** on the same set by end of Phase 2.
- **No regression** on any sub-class (factoid / relational / summary / numeric) vs. the Phase-0 baseline.

Phase 3+ targets are set after Phase-2 results are in.

## 3. Scope

**In scope**

- Cloud-side RAG pipeline under `apps/api/src/rag/` and `apps/api/src/document/`.
- Golden set + offline evaluator as a reusable artifact under `apps/api/src/rag/eval/` (service + CLI, DB-backed).
- Structure-preserving ingestion upgrade (PDF/Word → Markdown with tables + headings).
- Multi-representation chunk schema: `chunk_text`, `contextual_text`, `sample_questions[]`, `summary_1sent`, plus extracted `entities[]` / `keywords[]` in metadata.
- Query layer upgrades: classification → (optional) domain routing → rewrite + HyDE + decomposition.
- Cascaded retrieval: metadata pre-filter → hybrid recall → RRF → rerank → parent/section context expansion.
- GraphRAG enrichment (only if Phase-2 data shows relational-query failure mode).
- CI-integrated eval regression gate.

**Out of scope (this spec)**

- `apps/desktop` local RAG (sqlite-vec + fastembed-rs). Keep compatibility only — `hybrid-search.ts` must still merge cloud + local results after cloud-side schema changes.
- Multi-modal / visual retrieval branch (ColPali / ColQwen).
- Late chunking for very long documents.
- PageIndex-style document-level yes/no routing.

These are explicitly deferred to Phase 4 and re-evaluated only if Phase-0 through Phase-3 measurements show residual failure modes that the deferred techniques address.

## 4. Assumptions

1. OpenRouter embedding + chat endpoints remain the sole LLM providers; no self-hosted embedding model introduced.
2. The existing BGE cross-encoder sidecar (`RERANKER_URL`) stays as the rerank backend; Phase 0 will verify it is actually reachable in staging.
3. Postgres full-text search with `websearch_to_tsquery` remains the BM25 backend — no Elasticsearch / OpenSearch added.
4. The `document_chunks` table can be extended with new columns and re-indexed; no need to ship a zero-downtime dual-read migration for internal users.
5. The schema_versions-based hand-written SQL migration flow (per `CLAUDE.md`) is the only migration path; no drizzle-kit use.
6. User-provided clarifications hold:
   - Desktop RAG is kept compatible, not upgraded.
   - Golden set uses **strict (`expected_chunk_ids`) + lenient (`+acceptable_chunk_ids`)** scored separately.
   - Query-log source tables are `chat_messages` and `agent_events` (confirmed against `packages/db/src/schema/`).

## 5. Architecture

### 5.1 Target end-to-end flow (Phase 2 complete)

```
User query
  → QueryClassifierService   (factoid | relational | summary | numeric | navigational)
  → QueryPlannerService      (rewrite + HyDE + optional decomposition → N sub-queries)
  → MetadataPreFilterService (narrow candidate space by doc_type / sector / region / date / entities)
  → RetrievalOrchestratorService
        ├─ DenseLane   (chunk_text + contextual_text + sample_questions + summary — multi-index)
        ├─ SparseLane  (BM25 over weighted tsvector)
        └─ GraphLane   (entity-anchored, 2-hop CTE — Phase 3 only)
  → RetrievalFusionService   (RRF across lanes and sub-queries)
  → RerankService            (BGE cross-encoder, top-N → top-K)
  → ContextExpanderService   (parent/section rehydration, neighbor chunks)
  → ContextPackerService     (dedup, source diversity, token budget, provenance)
  → LLM generate
  → GroundednessVerifier     (citation check; optional per flag)
  → EvalLogger               (persist query + retrieved + used + feedback for golden-set growth)
```

### 5.2 Component responsibilities

| Component | Input | Output | Owns |
|---|---|---|---|
| `QueryClassifierService` | raw query | `{ class, confidence }` | Small LLM prompt + regex fallbacks. Sub-10 ms target. |
| `QueryPlannerService` | query + class | `{ rewritten, hyde_doc?, sub_queries[] }` | Decides whether to run HyDE / decomposition based on class. |
| `MetadataPreFilterService` | query + class | candidate doc_id set or SQL `WHERE` clause | Keyword → entity / sector mapping via lightweight LLM or rule table. |
| `RetrievalOrchestratorService` | planned queries + pre-filter | merged candidate list | Dispatch lanes in parallel; already exists, extend to accept pre-filter. |
| Dense / Sparse / Graph lanes | candidate query + pre-filter | scored chunk list | Dense lane **searches across all representations** (see §5.3). |
| `RetrievalFusionService` | lane results | fused ranking | RRF with configurable weights per class. |
| `RerankService` | top-N chunks + original query | top-K scored chunks | BGE cross-encoder sidecar; graceful fallback. |
| `ContextExpanderService` | top-K chunks | expanded passages | Pull parent section / neighbor chunks using `parent_id` / `section_path`. |
| `ContextPackerService` | expanded passages | final context | Already exists; reuse. |
| `RagEvalRunnerService` | golden set + pipeline version | recall / MRR / per-class report | New CLI + service; writes to `rag_eval_runs` table. |

### 5.3 Chunk schema changes (`document_chunks`)

Existing columns retained. New columns:

| Column | Type | Purpose | Population |
|---|---|---|---|
| `contextual_text` | text | Chunk text prefixed with ~50-token doc/section context (Anthropic pattern) | Generated at ingest |
| `sample_questions` | text[] | 1–3 questions this chunk can answer (Microsoft question-chunk alignment) | Generated at ingest |
| `summary_1sent` | text | One-sentence summary used for re-ranking features and summary-based pre-filter | Generated at ingest |
| `contextual_embedding` | vector(1536) | Embedding of `contextual_text` | Generated at ingest |
| `question_embedding` | vector(1536) | Max-pooled across per-question embeddings of `sample_questions` | Generated at ingest |
| `summary_embedding` | vector(1536) | Embedding of `summary_1sent` | Generated at ingest |
| `parent_id` | uuid | Parent section chunk (null for top-level) | At chunking |
| `section_path` | text | e.g. `"2. Risk Factors / 2.3 Counterparty"` | At chunking |

All three dense representations are searched and then merged via the dense lane's internal RRF before feeding the outer fusion. This is a deliberate design choice (per user brief §5 and Anthropic's Contextual Retrieval results) rather than replacing the base chunk embedding.

Sparse `search_vector` is widened to include `contextual_text`, `sample_questions`, and `summary_1sent` at reduced weights (C and D in PG `setweight`).

### 5.4 Ingestion upgrade

- PDF / Word parsing: integrate a structure-preserving parser (MinerU or a `pdf-parse` + heading-heuristic shim — Phase-1 will benchmark both; prefer MinerU if it can run as a sidecar service analogous to `RERANKER_URL`).
- Output canonical form is Markdown with headings, lists, and tables preserved. Tables are stored as both Markdown and optional CSV in metadata.
- Chunking respects heading boundaries first, then paragraph, then sentence. Overlap kept at 10% of chunk size.
- Images are NOT parsed this phase. Tables are kept textual.
- Per-chunk enrichment (contextual, sample_questions, summary, entities, keywords) runs as a separate Redis-Stream consumer after chunking, so ingestion throughput is not dominated by LLM latency. Failed enrichment falls back to base-text-only chunks (degraded but functional).

### 5.5 Evaluation loop

- **Golden set** stored in a new table `rag_golden_queries`:
  - `id`, `query`, `query_class`, `difficulty`, `expected_chunk_ids[]`, `acceptable_chunk_ids[]`, `notes`, `created_by`, `created_at`, `retired_at`.
  - Seeded 30 / 20 / 20–30 per §Q2: real chat logs (`chat_messages` + `agent_events`), synthesized-from-chunks, boundary-hard queries.
  - Labeling protocol: candidate-pair script proposes, human approves/overrides; stored under `docs/superpowers/specs/2026-04-19-rag-redesign-design/labeling-protocol.md` (to be added by Phase 0).
- **Runner**: `RagEvalRunnerService` + `pnpm --filter @finsentinel/api rag:eval` CLI. Writes per-run artifacts to `rag_eval_runs` table (run_id, pipeline_config_hash, metrics per class, raw per-query results).
- **Metrics**: recall@{1,5,10}, MRR@10, reported separately as strict (expected only) and lenient (expected ∪ acceptable). Per-class breakdown.
- **CI gate (Phase 0.5)**: `rag:eval` on a frozen sub-set runs in a nightly job; PR check compares against baseline and fails if strict recall@10 drops more than 3 pp.

### 5.6 Phasing

| Phase | Duration | Exit criteria |
|---|---|---|
| **P0**: Eval baseline | Week 1 | Golden set live (N ≥ 50), eval runner produces report, `RAG_MULTI_STAGE_ENABLED=true` baseline numbers recorded in `docs/exec-plans/`. |
| **P1**: Ingestion + multi-rep index | Weeks 2–3 | New columns migrated; enrichment consumer live; reindex of existing docs complete; strict recall@10 ≥ +10 pp over P0 baseline. |
| **P2**: Query layer + cascaded retrieval | Weeks 4–5 | Classifier + HyDE + decomposition + metadata pre-filter + context expansion live; targets in §2 met. |
| **P3**: GraphRAG enrichment | Weeks 6–7 | Only run if P2 per-class data shows relational-query class ≥ 10 pp below mean. Otherwise mark deferred and exit. |
| **P4**: Optional (late chunking, multimodal, PageIndex) | Deferred | Re-evaluate once P0–P3 are in production for one month. |

Each phase ends with an eval run and a progress-log entry in `docs/exec-plans/2026-04-19-rag-redesign.md` (created by writing-plans skill next).

## 6. Data flow and isolation

- Retrieval services are pure functions of `(query, pipeline_config)` and read-only on storage — no side effects during retrieval except structured eval logs.
- Ingestion and enrichment are strictly one-way writers into `document_chunks`; a failed enrichment row is re-driven by the stream consumer, never by retrieval.
- The eval runner talks to the same `RagRetrievalService` API that production chat uses — no parallel retrieval implementation, to prevent eval drift.
- Pipeline configuration (RRF weights, top-K, reranker model id, classifier thresholds) is a single versioned struct passed through the orchestrator, hashed into `pipeline_config_hash` for every eval run. This makes results reproducible and regressions traceable.

## 7. Error handling and degradation

| Failure | Behavior |
|---|---|
| Enrichment LLM fails for a chunk | Persist chunk with null multi-rep columns; mark `enrichment_status = 'failed'`; retry up to 3× in stream consumer. Retrieval still works using base embedding + sparse. |
| Reranker sidecar down | Fall back to RRF-only order (current behavior). Log at WARN, surface in eval run metadata. |
| Classifier LLM times out (> 500 ms) | Default to `class = "factoid"` and skip HyDE / decomposition. |
| HyDE generation fails | Drop the HyDE lane contribution; continue with rewritten query only. |
| Pre-filter returns empty candidate set | Skip pre-filter, run lanes on full index. Log at INFO. |
| Golden set eval run fails mid-flight | Partial results are discarded; `rag_eval_runs.status = 'failed'`; CI gate treats as "no data", not "regression". |

## 8. Testing strategy

- **Unit tests**: each new service (`QueryClassifierService`, `QueryPlannerService`, `MetadataPreFilterService`, `ContextExpanderService`, `RagEvalRunnerService`) has isolated tests with LLM calls mocked.
- **Integration tests**: pipeline happy-path test exercises end-to-end retrieval against a small seeded fixture (≤ 5 docs, ≤ 30 chunks) so CI does not need live LLM.
- **Offline eval**: `pnpm --filter @finsentinel/api rag:eval` run against the real golden set is the acceptance gate for each phase. Not part of unit CI; runs nightly and pre-merge on RAG-touching branches.
- **Contract test**: `hybrid-search.ts` in the web workspace asserts that cloud results with new fields still merge with local (desktop) results that lack those fields. Prevents the desktop compatibility regression.

## 9. Feature flags

Existing flags kept. New flags:

| Flag | Default | Purpose |
|---|---|---|
| `RAG_ENRICHMENT_ENABLED` | `false` → `true` after P1 reindex | Controls whether enrichment consumer writes multi-rep columns. |
| `RAG_QUERY_CLASSIFIER_ENABLED` | `false` → `true` at P2 | Gates classifier + routing. |
| `RAG_HYDE_ENABLED` | `false` → `true` at P2 | Gates HyDE lane. |
| `RAG_QUERY_DECOMPOSE_ENABLED` | `false` → `true` at P2 | Gates decomposition. |
| `RAG_METADATA_PREFILTER_ENABLED` | `false` → `true` at P2 | Gates pre-filter. |
| `RAG_CONTEXT_EXPANSION_ENABLED` | `false` → `true` at P2 | Gates parent/section rehydration. |
| `RAG_EVAL_CI_GATE_ENABLED` | `false` → `true` at end of P0 | Turns on the CI regression gate. |

All flags default to the pre-change behavior so a rollback is a single env-var flip.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Enrichment cost explodes (3 LLM calls + 3 embeddings per chunk) | Run as async consumer with configurable concurrency and rate limit. Benchmark cost on a 1 k-chunk sample in P1 before full reindex. Keep `RAG_ENRICHMENT_ENABLED=false` until cost is validated. |
| Multi-representation embeddings inflate pgvector storage | Estimate: 3 × 1536 × 4 bytes/float ≈ 18 kB per chunk + HNSW overhead. Monitor `pg_total_relation_size('document_chunks')`; add IVFFlat / HNSW lists tuning if latency regresses. |
| Multi-rep dense recall makes dense swamp BM25 | Lane-level RRF inside the dense lane prevents double-counting; outer RRF weights are tunable per query class. Eval runner reports per-lane contribution. |
| Golden set overfits the pipeline | Keep 20% of golden set as a frozen holdout that cannot be inspected when tuning. Rotate holdout quarterly. |
| MinerU / new parser introduces supply chain / license concerns | Benchmark vs. simpler `pdf-parse` + heading heuristic in P1; pick whichever meets accuracy bar with lower operational footprint. Do not block P1 on this decision — start with the shim and upgrade only if needed. |
| Desktop hybrid-search regression when cloud schema grows | Contract test in `apps/web` + compatibility column in cloud response DTO. Cloud DTO never returns fields desktop cannot parse; extra fields are opt-in via accept header or query param. |

## 11. Open questions (to resolve in writing-plans)

1. MinerU vs. `pdf-parse`-+-heuristic for P1 structure-preserving parsing — decide after a 24-hour spike.
2. Exact weight schedule for per-class RRF (`factoid` vs. `relational` vs. `summary`) — set empirically from P1 eval results.
3. Whether to run enrichment as a new Redis Stream or piggyback on the existing `VectorizeStream` — prefer new stream for isolation, confirm in plan.

## 12. Non-goals

- Not swapping the embedding provider.
- Not introducing a new vector store.
- Not refactoring unrelated services (chat, trading, analysis runtime) even where they touch retrieval.
- Not changing the public chat SSE contract.

## 13. Success definition

The redesign is complete when:

1. P0, P1, P2 are in production with flags on.
2. Strict recall@10 ≥ 0.75, lenient recall@10 ≥ 0.88, MRR@10 ≥ 0.55 on the golden set, no sub-class regression.
3. CI regression gate is green on two consecutive weekly runs.
4. A canonical summary plan under `docs/exec-plans/summaries/` captures outcomes, open debt, and any deferred P3 / P4 work.
