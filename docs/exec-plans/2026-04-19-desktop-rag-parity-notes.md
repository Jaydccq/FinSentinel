# Desktop RAG Parity Notes (T8)

**Date:** 2026-04-19
**Wave:** RAG redesign (T1-T8)
**Status:** Compatibility-only decision recorded

---

## Current State

Desktop local RAG lives entirely under `apps/desktop/src-tauri/`. It uses:

- **SQLite + sqlite-vec** virtual table for vector storage (single user-owned `.db` file).
- **fastembed-rs** bundled model for embeddings — runs fully offline; private docs never hit the network.
- **`SearchHit`** as the result type emitted by the Tauri `search_private_docs` command (`chunk_id`, `document_id`, `file_name`, `content`, `distance`).
- **`privateDocs.search()`** in `apps/web/src/lib/tauri/private-docs.ts` as the TypeScript bridge.

The web layer merges local and cloud results through `apps/web/src/lib/rag/hybrid-search.ts`, which converts `SearchHit.distance` to `1 - distance` similarity and tags entries with `provenance: 'local'`.

## Cloud Changes in This Wave (T1-T7)

T1 through T7 changed the cloud `CloudHit` shape and cloud-side retrieval behaviour:

- **T1** — Added stable `chunkId` and `sourceId` on every `CloudHit` so upstream callers can deduplicate and link hits back to `document_chunks`.
- **T2** — Introduced `document_chunk_representations` in pgvector. New representation surfaces (`contextual_text`, `sample_question`, `concise_summary`, `keywords`) live only in cloud storage and are never mirrored locally.
- **T3** — Markdown-first ingestion and heading-aware chunking. No desktop impact.
- **T4** — Query variant planner (rewrite, HyDE, subqueries). Runs only on the cloud retrieval path.
- **T5** — Orchestrator pre-filter, multi-representation dense + sparse + RRF canonical dedup, rerank. Cloud only. `CloudHit` gains optional fields: `representationTypesSeen`, `variantKindsSeen`, `fallbackReason`.
- **T6** — Partitioned `rag_query_logs` + `RagTraceService`. Server-side trace; no shape impact on `CloudHit` as seen by the web client.
- **T7** — Graph relation enrichment. Cloud side; activates on query cues behind `RAG_GRAPH_ENABLED`.

None of T1-T7 changed `SearchHit` or any code under `apps/desktop/src-tauri/`.

## Decision: Compatibility-Only This Wave

**This wave makes NO code changes under `apps/desktop/src-tauri/`.**

Desktop local RAG stays at its current capability level for the following reasons:

1. **fastembed model cost** — Generating contextual representations (T2 style) offline requires running an LLM pass per chunk. The bundled fastembed model is an embedding-only model; there is no local generation model.
2. **Single-file sqlite-vec DB** — The schema has one virtual table. Adding a representations table would require a SQLite schema migration and a re-index of all private documents.
3. **No network, no parsing sidecar** — Heading-aware chunking (T3) relies on Markdown structure produced by a document-parse pipeline. The Tauri side reads PDFs directly via Rust with no equivalent pipeline.
4. **No cloud sync, by design** — Private docs must never leave the machine (`No sync with cloud pgvector` is an explicit architecture constraint in `apps/desktop/README.md`).
5. **No sidecar** — Running a local reranker or query planner sidecar is out of scope for the desktop package.

The only desktop requirement for this wave is that `apps/web/src/lib/rag/hybrid-search.ts` continues to merge upgraded cloud hits (carrying T2-T5 extra fields) with `SearchHit` entries (which have no equivalent fields) without errors or regressions. That requirement is covered by the unit tests added in T8 (`apps/web/src/lib/rag/__tests__/hybrid-search.test.ts`).

## Forward Pointer

If desktop parity is revisited in a later wave, the candidate approaches are:

- **(a) Offline representation generator** — Run a smaller local LLM (e.g., a quantized Llama variant via llama.cpp) as a Tauri sidecar on first index to generate contextual text and sample questions per chunk, then store them in additional sqlite-vec columns. Cost: model download (1-4 GB), first-index latency, battery impact.
- **(b) Pre-generated representation bundles** — Download cloud-generated representations alongside private doc ingestion. This would break the privacy model (the cloud would need to see the private content to generate representations) and is **disfavored**.

Neither approach is in scope for the current wave.

## Verification

T8 unit tests in `apps/web/src/lib/rag/__tests__/hybrid-search.test.ts` cover:

- Cloud hits carrying T2-T5 extra fields merge cleanly.
- Local `SearchHit` entries without any new cloud fields merge cleanly, provenance stays `'local'`.
- Mixed-score sort stability: a local hit at 0.90 sorts above a cloud hit at 0.85 regardless of extra cloud fields.
- Cloud failure isolation: cloud exception returns local-only; no uncaught rejection.
- `localAvailable: false` skips local search entirely.
- Type-level assertion: `HybridHit` shape is backward-compatible.
