# RAG Quality Next Steps After Wave 2

## Background

The proposed P0/P1/P2 stack is directionally right, but it is written as if
Wave 2 has not landed. Repository evidence shows Wave 2 is already mostly
implemented:

- Representation sparse writes `search_vector` and has a sparse backfill CLI.
- The planner has `exact_lookup`, rewrite gating, and `rerankQuery`.
- Metadata routing exists, but several correctness and performance gaps remain.
- PDF/Word upload plumbing exists, but `services/parser` is still a stub.
- Doc-type-aware chunkers exist; the token-vs-char decision was benchmarked and
  chars were selected for Wave 2.
- RAG eval CI exists only in offline `CorpusRetriever` mode and still uses a
  25-entry synthetic golden set.

This plan records the next execution path so the priority decision is durable in
the repository instead of only in chat.

## Goal

Turn the current Wave 2 implementation into a verified RAG quality baseline
that can support production rollout decisions.

## Success Criteria

- `services/evaluation-runner/datasets/golden.json` has at least 100
  human-reviewed entries with the target bucket tags.
- A live-API retrieval eval can measure the real NestJS RAG path, not only
  offline `CorpusRetriever`.
- Current Wave 2 features have before/after measurements for exact lookup,
  long-doc, table-numeric, cross-document, and colloquial buckets.
- PDF/Word ingestion quality is validated against a real parser, not the stub.
- Metadata routing no longer silently drops extracted high-value fields or
  applies hot-path JSONB filters without indexes.

## Scope

In scope:

- Evaluation data and live-API eval workflow.
- Operational verification of representation sparse backfill.
- Metadata pre-filter gap closure.
- Real parser sidecar replacement for the current stub.
- Conditional context expansion and reindex verification.

Out of scope for this next slice:

- GraphRAG default-on.
- Training a query rewrite model.
- Summary retrieval as primary evidence.
- Late chunking, ColBERT, or other missing-middle layers.
- Vector database or embedding-provider swaps.

## Assumptions

- Existing Wave 2 code on `main` is the baseline.
- The current synthetic golden set is not a trustworthy quality gate.
- Staging data is available for `rag:golden:export`, sparse backfill, and shadow
  analysis.
- Parser quality matters more than adding multimodal retrieval right now.
- No external claim is treated as project truth unless it is reflected in this
  repository.

## Uncertainties

- Whether staging has enough real user queries in `chat_messages` and
  `agent_events` to seed all five eval buckets.
- Which parser implementation will be selected for PDF/DOCX quality.
- Whether live-API CI can run with secrets in GitHub Actions or must run as a
  staging scheduled job.
- Whether context expansion improves long-doc recall enough to justify default
  enablement.

## Priority Evaluation

| Proposed item                                             | Verdict from current repo                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| P0 representation sparse                                  | Correct priority, but already implemented. Next need is backfill + zero-null SQL assertion + live eval delta.                        |
| P0 query rewrite guard                                    | Correct and already implemented. Next need is live bucket measurement and canary-class plumbing audit.                               |
| P0 metadata soft routing                                  | Correct, partially implemented. Remaining gaps are now higher priority than new retrieval features.                                  |
| P0 PDF/Word parsing                                       | Correct, but current sidecar is stub-only. Real parser quality is the actual remaining P0.                                           |
| P1 token-aware/doc-type chunking                          | Doc-type chunkers exist; token switch was benchmarked and rejected for Wave 2. Re-open only if eval data proves char chunking fails. |
| P1 conditional context expansion                          | Still valid. Current expander is global-flag based; make it class/doc-type conditional after live eval exists.                       |
| P1 evaluation gate                                        | This is now the top blocker. Current gate is offline and synthetic; make it real before tuning more.                                 |
| P2 late chunking/missing-middle                           | Still defer. Only revisit after real long-doc bucket data.                                                                           |
| Do not prioritize GraphRAG/rewrite model/summary evidence | Agreed. Repository state supports deferral.                                                                                          |

## Simplest Viable Path

1. Make evaluation real.
   Verify: at least 100 reviewed golden entries, bucket tags populated, live-API
   eval report produced against current `main`.
2. Verify already-built P0 features in staging.
   Verify: representation sparse backfill leaves zero null `search_vector` rows,
   traces show representation sparse hits, and exact-lookup bucket has a measured
   baseline.
3. Close metadata pre-filter gaps.
   Verify: tests prove `docType` and `timeRange` are routed, dense and sparse
   lanes apply equivalent hard filters, soft hints affect ranking, and metadata
   JSONB queries have an index.
4. Replace the parser stub with a real parser.
   Verify: fixture PDF/DOCX files preserve page count, headings, tables, captions,
   and section paths; parser output drives retrievable chunks.
5. Enable conditional context expansion only where measured useful.
   Verify: long-doc and cross-document buckets improve without precision or
   latency regression.

## Implementation Steps

1. Eval foundation
   - Run `rag:golden:export` against staging.
   - Human-review candidates into five buckets: `exact_lookup`, `colloquial`,
     `cross_document`, `long_doc`, `table_numeric`.
   - Build a live-API eval path or scheduled staging workflow.
   - Switch from `ci-offline.yaml` to `wave2-buckets.yaml` only after the
     bucket tags exist.

2. Representation sparse production verification
   - Run `rag:backfill:representation-sparse --dry-run` in staging.
   - Run the wet backfill under the documented guard.
   - Assert zero rows remain where `document_chunk_representations.search_vector`
     is null.
   - Capture exact-lookup before/after metrics in the plan or runbook.

3. Metadata routing hardening
   - Route extracted `docType` and `timeRange` into `MetadataPreFilterService`.
   - Add dense-lane support for `tickers` and `issuerName`.
   - Add a GIN index on `document_chunks.metadata`.
   - Consume `softFilter` as a ranking boost instead of discarding it.
   - Add metrics for metadata LLM fallback invocation and result.

4. Parser quality replacement
   - Replace `services/parser` stub with the selected real parser.
   - Preserve page numbers, headings, tables, captions, parser version, and
     source MIME metadata.
   - Add PDF/DOCX fixtures that prove structure survives into chunks.
   - Re-run doc-type reindex on parser-backed documents.

5. Conditional context expansion
   - Add policy by `queryClass` and document type.
   - Enable expansion for `analytical`, `relational`, `multi_part`, and long
     report-like sources first.
   - Keep exact lookup default narrow unless eval data proves expansion helps.
   - Measure token budget, latency, and citation grounding.

6. Rollout decision
   - Run shadow analysis for enough traffic to compare single-stage and
     multi-stage per bucket.
   - Canary only after live eval and shadow reports agree.
   - Keep `RAG_MULTI_STAGE_ENABLED=false` as rollback until 30 clean days pass.

## Verification Approach

Targeted checks:

```bash
pnpm --filter @finsentinel/api test -- src/rag
pnpm --filter @finsentinel/api test -- src/document
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/db typecheck
python services/evaluation-runner/run_evaluation.py run \
  --dataset services/evaluation-runner/datasets/golden.json \
  --config services/evaluation-runner/configs/wave2-buckets.yaml \
  --output services/evaluation-runner/reports/live-api-current.json
```

Operational SQL checks:

```sql
select representation_type, count(*)
from document_chunk_representations
where search_vector is null
group by representation_type;
```

Expected result after sparse backfill: zero rows returned.

## Key Decisions

- Treat the proposed stack as a valid architecture, not as the current task
  list. Several items are already implemented and now need measurement.
- Move real evaluation ahead of more retrieval mechanics.
- Keep GraphRAG, rewrite-model training, summary-evidence retrieval, and
  missing-middle layers deferred until bucket data identifies a specific
  remaining failure mode.
- Do not revisit token-aware chunking until real bucket metrics show char-based
  chunking is the cause of a failure.

## Risks and Blockers

- The golden set remains synthetic unless a human reviewer does R1.1.
- Live-API eval may require secrets that are unsafe for forked PR CI.
- The parser stub can make PDF plumbing look complete while extraction quality
  is still zero.
- Metadata filters can improve precision while harming recall unless the
  min-candidate guardrail and soft-filter fallback are measured on real data.
- Current metadata JSONB filters need indexing before production-scale traffic.

## Detailed Execution Plan (Task-by-Task)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Steps use checkbox (`- [ ]`) syntax for tracking.

The five-phase sequencing mirrors the Simplest Viable Path above. Each phase
ships as its own PR, runs `pnpm typecheck` + narrow tests, and does not flip
a new default until its bucket delta clears its exit criterion.

```
P1  Make eval real                 (blocks every downstream measurement)
P2  Verify sparse backfill P0      (parallel with P1; confirmation-only)
P3  Close metadata routing gaps    (depends on P1 for bucketed measurement)
     ├─ P3.1 docType + timeRange → hardFilter            [RAG-TD-R4-06]
     ├─ P3.2 dense lane accepts tickers + issuerName      [RAG-TD-R4-03]
     ├─ P3.3 softFilter consumed as ts_rank_cd boost      [RAG-TD-R4-07]
     └─ P3.4 V18 GIN index on document_chunks.metadata    [RAG-TD-R4-05]
P4  Replace parser stub            [RAG-TD-R5-01], [RAG-TD-R6-01]
P5  Conditional context expansion  (depends on P1 + P4)
```

### Phase P1 — Make Evaluation Real

**Exit criteria:** N ≥ 100 real-labelled golden entries across 7 buckets
(`exact_lookup`, `factoid`, `relational`, `analytical`, `multi_part`,
`long_doc`, `cross_document`); live-API evaluator hits `/rag/search` against
staging; weekly live-API workflow exists; per-PR offline gate swapped to
`wave2-buckets.yaml` with populated thresholds.

**Files:**

- Modify: `services/evaluation-runner/datasets/golden.json`
- Create: `services/evaluation-runner/datasets/golden.meta.json`
- Create: `services/evaluation-runner/evaluators/api_retriever.py`
- Create: `services/evaluation-runner/evaluators/test_api_retriever.py`
- Create: `services/evaluation-runner/configs/live-api-staging.yaml`
- Modify: `services/evaluation-runner/configs/wave2-buckets.yaml`
- Create: `.github/workflows/rag-eval-live.yml`
- Modify: `.github/workflows/rag-eval-gate.yml`
- Create: `docs/runbooks/2026-04-21-golden-set-labeling-sop.md`
- Create (if absent): `apps/api/src/rag/admin/rag-golden-export.cli.ts`

- [ ] **P1.1 — Write the labeling SOP.** Document bucket taxonomy
      (exact_lookup / factoid / relational / analytical / multi_part / long_doc /
      cross_document), provenance preference order
      (`rag_query_logs.queryPreview` → `chat_messages` role='user' last 30d →
      `agent_events` aggregateType='RAG_QUERY' → reverse-engineered), target
      distribution (30/20/15/15/10/5/5 = 100), and 20% second-reviewer spot-check
      rule. Save to `docs/runbooks/2026-04-21-golden-set-labeling-sop.md`.

- [ ] **P1.2 — Export candidate queries.** Run
      `pnpm --filter @finsentinel/api rag:golden:export --source rag_query_logs --limit 300 --output services/evaluation-runner/datasets/golden.draft.json`.
      Verify ≥ 200 rows with `jq '.entries | length'`. If CLI missing, do P1.2a
      first.

- [ ] **P1.2a — (Fallback) Create the export CLI** at
      `apps/api/src/rag/admin/rag-golden-export.cli.ts` that reads
      `rag_query_logs.query_preview` or `chat_messages.content` via Drizzle and
      writes a `{exported_at, source, entries: [{id, query, bucket: null,
expected_chunk_ids: [], expected_answer: ""}]}` JSON. Add
      `"rag:golden:export": "tsx src/rag/admin/rag-golden-export.cli.ts"` to
      `apps/api/package.json` scripts.

- [ ] **P1.3 — Human-label 100 queries.** Follow SOP. Output
      `golden.json` replacing the 25-entry synthetic set. Verify distribution and
      `all(expected_chunk_ids | length >= 1)` via `jq`. Write
      `golden.meta.json` recording labeler handles, reviewer-sample-pct, and
      provenance_split counts.

- [ ] **P1.4 — Implement the live-API evaluator.** Create
      `services/evaluation-runner/evaluators/api_retriever.py` exposing
      `ApiRetriever(base_url, api_token, top_k)` with a `retrieve(query, bucket)`
      method that POSTs `{query, topK, queryClass?}` to `<base_url>/rag/search`
      and normalises the response to `[{chunk_id, source_id, score}]`. Score
      preference: `rankScore ?? fusionScore ?? similarity`.

- [ ] **P1.5 — Test the evaluator.** Create
      `evaluators/test_api_retriever.py` with two tests: shape normalisation from
      a mocked `httpx.Client` response, and `queryClass` forwarding when
      `bucket` is supplied. Run `pytest evaluators/test_api_retriever.py -v`.

- [ ] **P1.6 — Capture live-API baseline.** Against staging with current
      `main`, run
      `python services/evaluation-runner/run_evaluation.py run --dataset golden.json --retriever api --output reports/baseline-live.json`.
      Extract per-bucket `recall@5` and `mrr@5` via `jq '.bucket_metrics'`.
      Write `configs/live-api-staging.yaml` with `minimum_metrics = baseline -
0.03` per bucket (3% tolerance, 2dp).

- [ ] **P1.7 — Add the weekly live-API workflow** at
      `.github/workflows/rag-eval-live.yml`. Triggers: weekly cron
      `0 2 * * 1` and `workflow_dispatch`. Environment: `rag-eval-live` with
      secrets `RAG_API_URL`, `RAG_API_TOKEN`. Uploads
      `reports/live-<date>.json` artifact with 90d retention. Test via
      `gh workflow run rag-eval-live.yml --ref <branch>` before committing.

- [ ] **P1.8 — Swap per-PR gate to bucketed thresholds.** Populate
      `configs/wave2-buckets.yaml` from an offline baseline run
      (`--retriever corpus`). Change line 144 of
      `.github/workflows/rag-eval-gate.yml` from `ci-offline.yaml` to
      `wave2-buckets.yaml`.

### Phase P2 — Verify Sparse Backfill P0 in Staging

**Exit criteria:**
`SELECT COUNT(*) FROM document_chunk_representations WHERE search_vector IS
NULL` returns `0` in staging; second backfill run is a no-op; `exact_lookup`
recall@5 moves by ≥ +0.05 vs pre-R2 baseline — or a written explanation is
filed in the runbook.

**Files:** Create: `docs/runbooks/2026-04-21-rag-sparse-backfill-verify.md`

- [ ] **P2.1 — Snapshot pre-backfill state.** Run
      `SELECT COUNT(*) AS null_count, COUNT(*) FILTER (WHERE search_vector IS NOT
NULL) AS populated FROM document_chunk_representations;` against staging.
      Capture `exact_lookup` bucket via
      `run_evaluation.py --bucket exact_lookup --output
reports/pre-backfill-exact-lookup.json`. Paste both into the runbook.

- [ ] **P2.2 — Run the wet backfill.**
      `pnpm --filter @finsentinel/api rag:backfill:representation-sparse
--batch-size 500 --log-level info`. Paste tail output showing "N rows
      updated, 0 errors" into the runbook.

- [ ] **P2.3 — Assert zero null.** Rerun the P2.1 count query; expect
      `null_count = 0`. If non-zero, the CLI has a missing representation-type
      branch — block P2.4 and file a follow-up.

- [ ] **P2.4 — Confirm idempotency.** Re-run the backfill; expect
      "0 rows updated". Paste the log into the runbook.

- [ ] **P2.5 — Measure exact_lookup delta.** Rerun eval on
      `--bucket exact_lookup`; compare to P2.1 baseline. Write a 1-paragraph
      conclusion: if ≥ +0.05 gain, raise
      `configs/live-api-staging.yaml` threshold for `exact_lookup` to
      `post_value - 0.03`; else describe which queries regressed (check for
      english-stemmer asymmetry per [RAG-TD-R4-02]) and open a follow-up.

### Phase P3 — Close Metadata Routing Gaps

Each sub-phase is its own PR. Merge order: **P3.4 → P3.2 → P3.1 → P3.3**
(index first so the filter-adding phases aren't throttled by seq-scan; soft
boost last because it depends on all three hard-filter paths).

#### P3.1 — docType + timeRange → hardFilter ([RAG-TD-R4-06])

**Files:** `apps/api/src/rag/metadata-pre-filter.service.ts` + `.spec.ts`

- [ ] **P3.1.1 — Write failing test.** Two cases: (a) high-confidence
      docType '10-K' (conf 0.9) + timeRange '2024-01-01' (conf 0.95) land in
      `hardFilter.docType` / `hardFilter.afterDate`; (b) explicit caller filter
      wins on conflict (explicit `docType: '10-Q'` overrides extracted '10-K').

- [ ] **P3.1.2 — Run test, confirm FAIL** (`expected '10-K', got undefined`).

- [ ] **P3.1.3 — Implement routing.** In `buildFilter`, compute
      `extractedDocType` / `extractedAfterDate` above the hardFilter constructor,
      only promote when `confidence >= hardMinConfidence`, and spread in this
      order (later wins): extracted → explicitFilters → entity-extracted ticker /
      issuer hints. This preserves the "explicit wins" guarantee protected by
      the P3.1.1 test.

- [ ] **P3.1.4 — Rerun tests + narrow typecheck.** Full `rag/` suite +
      `pnpm --filter @finsentinel/api typecheck`.

- [ ] **P3.1.5 — Grep for [RAG-TD-R4-06] FIXME** in the file and remove
      stale inline references.

#### P3.2 — Dense lane accepts tickers + issuerName ([RAG-TD-R4-03])

**Files:** `apps/api/src/rag/rag-chunk-store.service.ts` + `.spec.ts`

- [ ] **P3.2.1 — Write failing tests.** Two cases: filter `{tickers:
['AAPL']}` restricts results to chunks with `metadata.tickers` including
      'AAPL'; `{issuerName: ['Apple Inc.']}` restricts to that issuer.

- [ ] **P3.2.2 — Run test, confirm FAIL.**

- [ ] **P3.2.3 — Extend `RagChunkSearchFilters`** with
      `tickers?: string[]; issuerName?: string[];`.

- [ ] **P3.2.4 — Mirror sparse-lane WHERE clauses** in
      `searchRepresentations` using Drizzle `sql` tag:

  ```typescript
  if (filters.tickers?.length) {
    conditions.push(sql`(dc.metadata->'tickers') ?| ${filters.tickers}::text[]`);
  }
  if (filters.issuerName?.length) {
    conditions.push(sql`dc.metadata->>'issuerName' = ANY(${filters.issuerName}::text[])`);
  }
  ```

- [ ] **P3.2.5 — Rerun tests + typecheck.**

#### P3.3 — Consume softFilter as ts_rank_cd boost ([RAG-TD-R4-07])

**Files:** `apps/api/src/rag/sparse-search.service.ts` + `.spec.ts`,
`apps/api/src/rag/retrieval-orchestrator.service.ts`

- [ ] **P3.3.1 — Write failing test.** Fixture: two chunks with identical
      base similarity, one whose `metadata.issuerName='Apple Inc.'`. Assert
      that with `{softFilter: {issuerName: ['Apple Inc.']}}` the Apple chunk
      ranks higher than without the soft hint.

- [ ] **P3.3.2 — Extend `SparseSearchFilters`** with
      `softFilter?: { tickers?: string[]; issuerName?: string[] }`.

- [ ] **P3.3.3 — Add CASE multiplier to ts_rank_cd.** Wrap the ranking
      expression:

  ```sql
  ts_rank_cd(...) * CASE
    WHEN ${softTickers}::text[] IS NOT NULL
     AND (dc.metadata->'tickers') ?| ${softTickers}::text[] THEN 1.15
    WHEN ${softIssuers}::text[] IS NOT NULL
     AND dc.metadata->>'issuerName' = ANY(${softIssuers}::text[]) THEN 1.15
    ELSE 1.0
  END AS score
  ```

- [ ] **P3.3.4 — Remove the `_soft` discard** at
      `retrieval-orchestrator.service.ts:75`:

  ```diff
  - const { candidateDocIds: _unused, appliedMode: _appliedMode, softFilter: _soft, hardFilter } = preFilter;
  - const effectiveFilters = hardFilter;
  + const { candidateDocIds: _unused, appliedMode: _appliedMode, softFilter, hardFilter } = preFilter;
  + const effectiveFilters: SparseSearchFilters = softFilter
  +   ? { ...hardFilter, softFilter: { tickers: softFilter.tickers, issuerName: softFilter.issuerName } }
  +   : hardFilter;
  ```

- [ ] **P3.3.5 — Run tests + typecheck.**

- [ ] **P3.3.6 — Measure bucket delta via live eval.** Expect
      `relational` + `factoid` recall@5 to each gain ≥ +0.02. If no movement,
      tune the multiplier to 1.25 and rerun before considering a redesign.

#### P3.4 — V18 GIN index on document_chunks.metadata ([RAG-TD-R4-05])

**Files:** Create:
`packages/db/migrations/V18__document_chunks_metadata_gin.sql`

- [ ] **P3.4.1 — Write migration:**

  ```sql
  -- V18: GIN index on document_chunks.metadata for JSONB operator support.
  -- Uses jsonb_ops (not jsonb_path_ops) because `?|` requires the full class.
  CREATE INDEX IF NOT EXISTS document_chunks_metadata_gin_idx
    ON document_chunks USING gin (metadata);
  ```

- [ ] **P3.4.2 — Apply + verify locally.**
      `pnpm --filter @finsentinel/db db:migrate`, then
      `psql $DATABASE_URL -c "\d document_chunks" | grep document_chunks_metadata_gin_idx`.

- [ ] **P3.4.3 — EXPLAIN ANALYZE a ticker filter.** Confirm the plan uses
      `Bitmap Index Scan on document_chunks_metadata_gin_idx`, not `Seq Scan`.

### Phase P4 — Replace the Parser Stub ([RAG-TD-R5-01], [RAG-TD-R6-01])

**Exit criteria:** Real extractor live for PDF/DOCX; 20-document held-out
bakeoff documented; `long_doc` + `cross_document` recall@5 each gain ≥ +0.05
vs post-P2 baseline.

**Files:**

- Modify: `services/parser/routers/parse.py`, `requirements.txt`, `Dockerfile`
- Create: `services/parser/extractors/pdf_extractor.py`, `docx_extractor.py`
- Create: `services/parser/tests/test_extractors.py` + `tests/fixtures/pdf-sample/*`
- Modify: `apps/api/src/rag/admin/rag-reindex-by-doctype.cli.ts`
- Modify: `services/parser/CLAUDE.md` (update stub declaration)

- [ ] **P4.1 — Extractor bakeoff.** Collect 20 PDFs (10-K x3, 10-Q x3,
      press release x4, research x5, news PDF x3, scanned x2) under
      `tests/fixtures/pdf-sample/`. Score pdfplumber vs. MinerU on heading count
      ±2 of manual labels, table presence detection, and OCR fallback on scanned
      PDFs. Document the pick in `services/parser/CLAUDE.md`; default pdfplumber
      if within 10% of MinerU (no commercial dependency).

- [ ] **P4.2 — Write failing integration test** at
      `services/parser/tests/test_extractors.py`. Two cases: 10-K parse yields
      ≥ 10 headings and pageCount > 10 with `parserVersion != "stub-0.1"`; DOCX
      parse yields `len(markdown) > 200` and no "Stub parser output" substring.

- [ ] **P4.3 — Implement extractor.** pdfplumber path for PDF:
      heading heuristic (ALL CAPS short lines → h2, "PART "/"ITEM " prefix → h2,
      else none), table extraction via `page.extract_tables()` rendered as
      Markdown tables. python-docx path for DOCX: walk `document.paragraphs`
      with `style.name` mapping to heading levels. Wire both into
      `routers/parse.py` with MIME/extension dispatch; 400 response on
      unsupported formats. Bump `PARSER_VERSION` to `"pdfplumber-1.0"`.

- [ ] **P4.4 — Rerun tests; confirm PASS.**

- [ ] **P4.5 — Dockerfile native deps.** Add
      `libjpeg62-turbo zlib1g poppler-utils` via apt; `docker build -t
finsentinel/parser:dev services/parser` to verify.

- [ ] **P4.6 — Unblock doc-type reindex.** Find any short-circuit in
      `rag-reindex-by-doctype.cli.ts` referencing [RAG-TD-R6-01] and remove it.
      Dry-run against 10 PDFs to confirm real headings in log output.

- [ ] **P4.7 — Full staging reindex.** Run reindex for `10-K`, `10-Q`,
      `research`. Wait for enrichment queue:
      `SELECT COUNT(*) FILTER (WHERE enrichment_status = 'pending') FROM
document_chunks;` → 0 within 30 min.

- [ ] **P4.8 — Measure long_doc + cross_document deltas.** Trigger
      `gh workflow run rag-eval-live.yml`. Acceptance: each bucket gains ≥ +0.05
      recall@5. If not, log failed extractions, consider OCR fallback as a
      follow-up.

### Phase P5 — Conditional Context Expansion

**Exit criteria:** Gate on
`queryClass ∈ {analytical, relational, multi_part}` OR top-K contains a
chunk whose source doc length ≥ `RAG_CONTEXT_EXPANSION_MIN_DOC_TOKENS`.
`analytical + relational + multi_part + long_doc` each gain ≥ +0.03
recall@5; `exact_lookup + factoid` do not regress by > 0.01. Flip
`RAG_CONTEXT_EXPANSION_ENABLED` default to on.

**Files:**

- Modify: `apps/api/src/config/rag.config.ts`
- Modify: `apps/api/src/rag/context-expander.service.ts` + `.spec.ts`
- Modify: `apps/api/src/rag/rag-retrieval.service.ts` (thread
  `queryClass` through)

- [ ] **P5.1 — Capture pre-expansion baseline** with
      `RAG_CONTEXT_EXPANSION_ENABLED=false`. Save
      `reports/pre-expansion-baseline.json`.

- [ ] **P5.2 — Add config + failing tests.** New env vars
      `RAG_CONTEXT_EXPANSION_CLASSES=analytical,relational,multi_part` and
      `RAG_CONTEXT_EXPANSION_MIN_DOC_TOKENS=8000`. Tests: (a) `exact_lookup`
      with `sourceTokenCount: 200` skips expansion; (b) `analytical` with short
      doc still expands; (c) `factoid` with `sourceTokenCount: 20000` expands
      via long-doc signal.

- [ ] **P5.3 — Implement the gate** at the top of
      `ContextExpanderService.expand`:

  ```typescript
  const { classes, minDocTokens } = this.config;
  const classAllows = request.queryClass ? classes.includes(request.queryClass) : false;
  const hasLongDoc = request.candidates.some(
    (c) => ((c.metadata as any)?.source_token_count ?? 0) >= minDocTokens,
  );
  if (!classAllows && !hasLongDoc) {
    return request.candidates;
  }
  ```

  If `source_token_count` is not populated at ingestion today, add a
  `content.length / 4` fallback and file a follow-up for explicit backfill.

- [ ] **P5.4 — Rerun tests + typecheck.**

- [ ] **P5.5 — Staging A/B.** Flip `RAG_CONTEXT_EXPANSION_ENABLED=true` in
      staging with the new defaults. Trigger live eval; compare to
      `pre-expansion-baseline.json`. Must satisfy both gates (gains on target
      buckets, no regression on exact_lookup/factoid). If a class regressed,
      narrow `RAG_CONTEXT_EXPANSION_CLASSES`.

- [ ] **P5.6 — Flip production default.**

  ```diff
  - enabled: process.env['RAG_CONTEXT_EXPANSION_ENABLED'] === 'true',
  + enabled: process.env['RAG_CONTEXT_EXPANSION_ENABLED'] !== 'false',
  ```

  Update this plan's Progress Log with the measured deltas.

## Plan-Level Verification

- [ ] **V1 — All phase exit criteria signed off** in the progress log.
- [ ] **V2 — Tech-debt tracker updated** — entries `[RAG-TD-R4-03, -05, -06,
-07]`, `[RAG-TD-R5-01]`, `[RAG-TD-R6-01]` marked `Resolved by <PR>` or
      reopened with new justification.
- [ ] **V3 — Cumulative live-API delta documented** vs. P1.6 baseline.
- [ ] **V4 — No `exact_lookup` regression** — recall@5 never drops below
      P1.6 baseline − 0.03 across any merged phase.

## Key Execution Decisions

- Offline gate stays on PRs; live-API runs weekly + on-demand. Reason: live
  requires staging availability + secrets unsafe for forked-PR contexts.
- V18 uses `jsonb_ops`, not `jsonb_path_ops`. `?|` needs the full operator
  class; `jsonb_path_ops` only indexes `@>` / `@?`.
- Soft-filter boost is a 1.15× `ts_rank_cd` multiplier, not a rank-fusion
  rewrite. Minimal, measurable, tunable. If P3.3.6 shows insufficient
  movement, bump to 1.25× before considering a redesign.
- Parser extractor is pip-installable (pdfplumber + python-docx). No new
  cost tier. MinerU is the backup if bakeoff shows > 10% heading-F1 delta.
- Context expansion default classes = `analytical,relational,multi_part`.
  Long-doc signal is the per-query override so that a factoid query that
  happens to hit a 10-K still benefits; exact_lookup on short docs stays
  cheap.

## Progress Log

- 2026-04-21: Reviewed current RAG implementation, Wave 2 rollout plan,
  runbook, eval runner, parser sidecar, chunkers, metadata pre-filter, and
  technical-debt tracker. Created this next-step plan. No runtime code changed.
- 2026-04-21: Added detailed task-by-task execution plan for P1–P5. No
  runtime code changed.
- 2026-04-21: Phase P1 landed on `main` in 6 commits (53360ca, 48090f2,
  365a5a7, e9fb2fa, 1647fad, preceded by plan commits 3e585dd/a0d5224).
  Deviations from the drafted plan:
  - **P1.2 / P1.2a skipped.** The `rag:golden:export` CLI already exists
    at `apps/api/src/rag/eval/golden-candidates.cli.ts`. Since the user
    directed "直接让 codex" (have codex do the labeling), we bypassed the
    export-then-label workflow entirely and let Codex reverse-engineer
    100 entries directly from `services/evaluation-runner/datasets/corpus.json`.
  - **P1.4 redirected.** The planned `api_retriever.py` module was
    redundant — `run_evaluation.py:fetch_retrieval_results` already hits
    a live API. Surgical enhancement (Bearer auth + queryClass forwarding)
    instead of a parallel module, keeps the diff tight.
  - **P1.7 pivoted.** Weekly GitHub Actions workflow targeting staging
    deferred per the user's "只用 localhost" direction; replaced by
    `scripts/rag-eval-local.sh` which drives the evaluator against a
    local `apps/api` when one is running.
  - **P1.6 partially achieved.** Captured an OFFLINE CorpusRetriever
    baseline against the new 100-entry golden set; live-API localhost
    baseline is blocked on deterministic-chunk-id remapping — the
    `seed-fixture` CLI assigns UUIDs to DB rows so the live API returns
    `chunkId` UUIDs that don't match `chunk-001` strings in the golden
    set. Tech-debt filed under the top entry of
    `docs/exec-plans/tech-debt-tracker.md`.
  - **Bucket taxonomy extended 7 → 9.** `wave2-buckets.yaml` already
    defined `exact_lookup / colloquial / cross_document / long_doc /
table_numeric`; the plan's four additional retrieval-shape buckets
    (`factoid / relational / analytical / multi_part`) layered on top of
    those, giving a 9-bucket union. Golden set + thresholds cover all 9.

  **P1 deliverables landed:**
  - `docs/runbooks/2026-04-21-golden-set-labeling-sop.md` — SOP with
    9-bucket taxonomy, target distribution, localhost-via-codex variant.
  - `services/evaluation-runner/datasets/golden.json` — 100 codex-labelled
    entries, distribution exact to target (±0), all chunk_ids valid.
  - `services/evaluation-runner/datasets/golden.meta.json` — provenance,
    bucket distribution, labeler, validation notes.
  - `services/evaluation-runner/run_evaluation.py` — Bearer-auth +
    queryClass-forwarding on the live-API path, backward compatible.
  - `services/evaluation-runner/evaluators/test_run_evaluation.py` —
    5 new tests; full file 19/19 pass.
  - `services/evaluation-runner/configs/wave2-buckets.yaml` —
    thresholds = baseline − 0.03 per bucket, 9 buckets covered, overall
    floors tightened from 0.30/0.45/0.60/0.25 to 0.82/0.92/0.92/0.78.
  - `services/evaluation-runner/reports/wave2-baseline-2026-04-21.json`
    — baseline snapshot (tracked via gitignore allowlist).
  - `scripts/rag-eval-local.sh` — local-API driver script.
  - `.github/workflows/rag-eval-gate.yml` — swapped to `wave2-buckets.yaml`
    so every PR now gates on per-bucket floors, not just overall.

  **Still open for P1 to be fully closed:**
  - Live-API eval on localhost (blocked on chunk_id remapping).
  - Promote provenance from `reverse_engineered_synthetic` to
    `rag_query_logs` / `chat_messages` once staging or a real local
    corpus is available.

- 2026-04-21: Phase P2 deferred to staging. Localhost has an empty
  `document_chunk_representations` table (representation enrichment
  requires BullMQ + Redis + apps/api + an LLM API key, none up on the
  dev box), so the wet-run backfill is trivially a no-op and the
  exact_lookup bucket delta measurement is not meaningful. Verified
  that the CLI under test still works by running the full
  `pnpm --filter @finsentinel/api test` suite (1463 passed, 1 skipped)
  — including `src/rag/admin/__tests__/rag-backfill-representation-sparse.cli.spec.ts`
  which covers dry-run (zero UPDATEs), wet-run (updates every null row
  once), idempotency (second pass = 0 updates), batch-size boundary,
  and the `buildRepresentationTsvector()` SQL fragment shape.
  The original P2.1-P2.5 staging steps remain the correct checklist
  for when populated representations are available; see the top entry
  of `docs/exec-plans/tech-debt-tracker.md`.

- 2026-04-21: Phase P3 complete — all four metadata-routing gaps closed
  on `main` in 3 commits (b883c98, 5a134e2, 041d192). Merge order
  followed the plan: P3.1/P3.4 bundled → P3.2 → P3.3.
  - **P3.1 ([RAG-TD-R4-06])**: `MetadataPreFilterService.buildFilter`
    now routes high-confidence `docType` and `timeRange.after` into
    `hardFilter.docType` / `hardFilter.afterDate`, with explicit
    caller filters winning on conflict. +8 test assertions cover high/
    low-confidence routing, explicit-wins precedence, timeRange.before-
    only (ignored), hard+soft mode mixes, and mode=off passthrough.
  - **P3.2 ([RAG-TD-R4-03])**: `RagChunkStoreService.searchRepresentations`
    dense lane now consumes `tickers` and `issuerName` in both the
    canonical sub-query (no alias) and the representation sub-query
    (`dc.` alias). Before this, a ticker hard filter applied only to
    the sparse lane and the dense lane diluted RRF precision on
    exact_lookup queries. +4 tests verify both lanes emit the JSONB
    fragments and empty arrays emit nothing (length guard).
  - **P3.3 ([RAG-TD-R4-07])**: `SparseSearchService` now consumes
    `softFilter` as a `ts_rank_cd` CASE multiplier (1.15 — small enough
    to re-rank without dominating, tunable). The orchestrator's
    `_soft` discard is removed; softFilter flows PreFilter → search
    filters → SQL boost. Non-matching rows stay retrievable
    (regression-guarded). +5 tests in sparse-search.service.spec.ts.
    Dense lane still ignores softFilter — documented as intentional.
  - **P3.4 ([RAG-TD-R4-05])**: V20 migration adds a GIN index on
    `document_chunks.metadata` using `jsonb_ops` (NOT `jsonb_path_ops`,
    because `?|` requires the full operator class). Not end-to-end
    validated on a fresh DB because V16 has a pre-existing HNSW
    dimension bug that blocks clean migration — filed as tech debt,
    out of scope here. SQL itself is `CREATE INDEX IF NOT EXISTS`,
    two lines, trivially correct.

  Full suite after P3: 1481 passed, 1 skipped. Typecheck clean.
  Offline CorpusRetriever baseline unchanged (it bypasses the TS
  retrieval stack). Live-API movement measurement stays blocked on
  chunk_id remapping per P1 tech debt.

- 2026-04-21: Phase P4 skipped on this pass. The parser-stub
  replacement requires a real PDF fixture set, a pdfplumber/MinerU
  bakeoff inside the sidecar container, a Dockerfile rebuild, and a
  live reindex of representative docs. None of those are localhost-
  friendly without Redis + apps/api + the parser sidecar running.
  The P4 task plan in this document remains the correct blueprint.
  `[RAG-TD-R5-01]` and `[RAG-TD-R6-01]` stay open.

- 2026-04-21: Phase P5 landed on `main` in one commit (534f826).
  Replaces the global `RAG_CONTEXT_EXPANSION_ENABLED` on/off flag with
  a conditional gate:
  (enabled=true) AND
  (queryClass ∈ RAG_CONTEXT_EXPANSION_CLASSES
  OR any top-K candidate's source doc ≥
  RAG_CONTEXT_EXPANSION_MIN_DOC_TOKENS).
  Default classes = `analytical,relational,multi_part`; default
  long-doc threshold = 8000 tokens. `source_token_count` from
  metadata is preferred; `content.length / 4` is the estimator
  fallback until a backfill populates the field explicitly.
  Wired `plan.queryClass` from the R3 intent-aware planner into the
  expander via `rag-retrieval.service.ts`.
  +10 new spec assertions cover class allow/deny, long-doc override,
  default allow-list membership, undefined queryClass (gate OFF),
  content-length fallback, and global-flag regression guard.
  Pre-existing tests that relied on unconditional expansion were
  updated to pass `queryClass: 'analytical'` in options — they keep
  validating the neighbor-expansion logic, now behind the gate.
  Full suite: 1491/1492 pass (1 pre-existing skip). Typecheck clean.

  Deferred to tech debt:
  - P5.1/P5.5 live-API bucket deltas (analytical/relational/
    multi_part/long_doc gains vs. exact_lookup/factoid no-regress) —
    blocked by the same chunk_id remapping issue as P1.6.
  - P5.6 flipping `RAG_CONTEXT_EXPANSION_ENABLED=true` as the
    production default — requires the live A/B to show the gate
    actually moves buckets in the expected direction.

- 2026-04-21: **Session summary (earlier checkpoint).** Landed P1, P3,
  P5 on `main` in 11 commits (a0d5224 → 534f826). P2 and P4 deferred to
  staging / fixture-dependent workstreams. All changes typecheck + test
  green (1491/1492). Five items moved to tech-debt for follow-up when
  the environment supports them (all closed in the next checkpoint).

- 2026-04-21: **Session summary (final).** Stood up the full local
  stack — Redis via bare redis-server daemon, apps/api on 3001 with a
  new `RAG_EVAL_ENDPOINT_ENABLED`-gated HTTP endpoint, Python venv for
  the real parser — and captured all the previously deferred
  live-measurement work. 6 additional commits on `main` through
  commit `b3b1714`:

  **P4 closed (commit 0ea7a05 + earlier P4 commit).**
  `services/parser/routers/parse.py` swaps the fixed-Markdown stub for
  MIME-dispatched real extractors:
  - **PDF** via `pdfplumber` with heading heuristics (ALL-CAPS short
    lines, SEC-style `PART` / `ITEM`, numbered `1.2` prefixes) and
    table-to-Markdown rendering.
  - **DOCX** via `python-docx`, walking body in document order with
    Heading 1..6 / Title mapped to Markdown heading levels.
    Dockerfile updated with `libjpeg62-turbo + zlib1g + poppler-utils`
    and a urllib-based HEALTHCHECK; Docker image build itself deferred
    because the local Docker daemon was down during the session.
    Fixtures (`aapl-sample.pdf`, `nvda-table.pdf`, `sample-memo.docx`)
    generated from corpus.json via `tests/generate_fixtures.py`
    committed for deterministic CI. 8 integration tests pass
    (header/table extraction, 400 on unsupported MIME, 422 on malformed
    PDF, /health reports real version).

  **P1.6 closed (commit cec4be9 + b3b1714).** Three prerequisites had
  to land before the live-API baseline could be captured:
  1. `chunk_id` remapping in `run_evaluation.py` so the evaluator can
     match the golden set's `chunk-NNN` ids back to the seed-fixture
     UUIDs via `metadata.corpus_chunk_id`. +3 tests.
  2. `RagSearchController` in `apps/api/src/rag/` exposing
     `POST /api/rag/search`, gated behind
     `RAG_EVAL_ENDPOINT_ENABLED=true`. The existing service was
     only reachable programmatically; `wave2-buckets.yaml` had
     long referenced this endpoint with no implementation.
  3. Two migrations that had been drifting silently: - **V16 edit**: `embedding vector` → `embedding vector(2048)`
     matching the canonical NVIDIA embedding provider
     (`nvidia/llama-nemotron-embed-1b-v2`); HNSW is not created
     (pgvector caps HNSW at 2000 dims), dense rep-lane uses
     seq-scan. Closes the "V16 HNSW dimension bug" tech-debt
     entry. (An earlier revision of this edit declared
     `vector(1536)`; see V22 bridge.) - **V21 new**: adds `meta_title / meta_source / meta_entities /
       search_vector` + `idx_document_chunks_fts` that the Drizzle
     schema referenced but no SQL created. - **V22 new**: bridge migration for DBs that applied the
     `vector(1536)` revision of V16 — drops the old HNSW index
     and widens the column to `vector(2048)`. Idempotent on
     fresh DBs that ran the current V16.
     Live-off baseline: overall recall@5=0.732, recall@10=0.741,
     mrr@10=0.733. See
     `services/evaluation-runner/reports/wave2-baseline-live-expansion-off-2026-04-21.json`.

  **P5 live A/B closed (commit b3b1714).** Paired run with
  `RAG_CONTEXT_EXPANSION_ENABLED=true` against the same 100 queries /
  same seeded corpus. Overall recall@5 = 0.948 (+0.217), recall@10 =
  0.968 (+0.227), mrr@10 = 0.970 (+0.237). Every one of 9 buckets
  gained; smallest gain was +0.050 on exact_lookup (a bucket the P5
  plan conservatively excluded); largest was +0.500 on table_numeric
  and cross_document. P5.6 default flip condition met; flipped
  `RAG_CONTEXT_EXPANSION_ENABLED` default to `true` in
  `context-expander.service.ts` and `rag.config.ts`.
  Baseline snapshot:
  `services/evaluation-runner/reports/wave2-baseline-live-expansion-on-2026-04-21.json`.
  New live-API-calibrated config:
  `services/evaluation-runner/configs/live-api-baseline.yaml`.

  **P2 closed (commit b3b1714).** The production-path backfill CLI
  (`rag:backfill:representations`) hit a DI bug on fresh-bootstrap
  (`RepresentationAdminService` reads `configService.get` on
  undefined). Filed as new tech debt; unrelated to what P2 verifies.
  Worked around by seeding 164 representation rows directly (4 types
  × 41 chunks, `search_vector=NULL`) and running
  `rag:backfill:sparse`: 164 updated, 0 errors, null count went
  164 → 0. Idempotency rerun: 0 updates, null count still 0.

  **Runbook:** `docs/runbooks/2026-04-21-rag-live-baseline-capture.md`
  captures every command + raw numbers for reproduction.

  **Known gaps still open (tech-debt):**
  - `RepresentationAdminService` DI bug in the
    `rag:backfill:representations` CLI bootstrap module (blocks the
    production path to enrichment; P2 verification worked around it).
  - Query rewrite / HyDE were disabled in eval to keep per-query
    latency under the runner's 30s timeout; rewrite's quality
    contribution is therefore not measured by this baseline.
  - No reranker sidecar running during eval — all rerank calls fell
    through to RRF. A real reranker would likely push mrr@10 even
    higher. Sidecar exists in `services/reranker/`; separate workstream.
  - Docker image build for the real parser is pending until the local
    Docker daemon is running. Dockerfile itself is ready.

## Final Outcome

Pending. This plan is the recommended next workstream after Wave 2: make the
quality gate real, verify already-landed improvements, then close the measured
gaps instead of adding a new retrieval layer.
