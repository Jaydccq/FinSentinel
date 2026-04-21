# Technical Debt Tracker

## Active Gaps

### Cloud RAG quality work is blocked by synthetic/offline evaluation and stub parsing

- **Observed:** 2026-04-19 while preparing the RAG redesign plan; updated
  2026-04-21 after Wave 2 landed and a task-by-task execution plan was
  appended to `docs/exec-plans/2026-04-21-rag-quality-next-steps.md`.
- **Evidence:** Wave 2 now accepts PDF/Word MIME types, writes representation
  `search_vector`, adds metadata routing, and includes doc-type-aware chunkers.
  The remaining blockers are that `services/evaluation-runner/datasets/golden.json`
  still has 25 synthetic entries, `.github/workflows/rag-eval-gate.yml` uses
  offline `CorpusRetriever` instead of the live API path, and
  `services/parser/` is a stub that returns fixed Markdown for any uploaded file.
- **Impact:** RAG quality changes cannot be trusted as production improvements
  until real bucketed queries and real parser output are measured.
- **Likely fix path:** Execute
  `docs/exec-plans/2026-04-21-rag-quality-next-steps.md` — phases P1–P5 in
  order:
  - P1 replaces synthetic golden set with N ≥ 100 real-labelled queries and
    adds a live-API eval workflow.
  - P2 verifies the sparse backfill in staging
    (`search_vector IS NULL = 0`) and measures the `exact_lookup` bucket
    delta.
  - P3 closes `[RAG-TD-R4-03] / [RAG-TD-R4-05] / [RAG-TD-R4-06] /
    [RAG-TD-R4-07]` (docType/timeRange routing, dense-lane ticker/issuer
    filters, softFilter consumption, V18 GIN index).
  - P4 replaces the parser stub (closes `[RAG-TD-R5-01]` and
    `[RAG-TD-R6-01]`).
  - P5 makes context expansion conditional on `queryClass ∈
    {analytical, relational, multi_part}` OR a long-document signal, then
    flips the default.
- **Status:** P1, P3, P4, P5 all closed 2026-04-21; P2 verified via
  direct-insert workaround. Live-API A/B on localhost showed
  `RAG_CONTEXT_EXPANSION_ENABLED=true` is strictly better on every
  bucket (+0.050 exact_lookup → +0.500 table_numeric / cross_document
  recall@5). Default flipped to on in `rag.config.ts` and
  `context-expander.service.ts`. See
  `docs/runbooks/2026-04-21-rag-live-baseline-capture.md` for commands
  + numbers.

  **Remaining smaller items:**
  1. **chunk_id remapping** — CLOSED 2026-04-21. Now in
     `run_evaluation.py:_coerce_chunk` preferring
     `metadata.corpus_chunk_id` when seed-fixture was used; +3 tests.
  2. **Provenance is still `reverse_engineered_synthetic`.** The
     100-entry golden set was codex-generated from corpus.json, not
     drawn from real user queries. Promote to `rag_query_logs /
     chat_messages` provenance once staging access lands or a
     reasonably-populated local corpus is in place; then re-baseline
     `wave2-buckets.yaml`. Still open.
  3. **Query rewrite / HyDE off during live eval.** Per-query latency
     with rewrite on exceeded the runner's 30s timeout. The live
     baseline therefore measures retrieval-quality with rewrite
     removed. Quality contribution of rewrite is not captured here;
     revisit with an async-variant plumbing or a faster provider.
  4. **Reranker sidecar not running during live eval.** All rerank
     calls fell through to RRF (expected — rerank is optional). A
     real reranker would likely push mrr@10 higher. Exists in
     `services/reranker/` as a separate workstream.
  5. **Docker image build for the real parser deferred.** Local
     Docker daemon down during the session. Dockerfile + deps are
     ready; standard `docker build` once daemon is back.

### V16 migration fails on a fresh DB — RESOLVED 2026-04-21

- **Observed:** 2026-04-21 while attempting to apply migrations to a
  fresh `finsentinel_test` DB to validate V20 (GIN index) for P3.4 of
  `docs/exec-plans/2026-04-21-rag-quality-next-steps.md`.
- **Command:** `DATABASE_URL=... pnpm --filter @finsentinel/db db:migrate`
- **Failure:** V16 declares
  `document_chunk_representations.embedding vector` without a dimension
  (`vector` not `vector(1536)`), then tries to create
  `idx_dcr_embedding_hnsw ... USING hnsw (embedding vector_cosine_ops)`.
  HNSW requires a typed-dimension column, so Postgres errors with
  `column does not have dimensions` (pgvector `hnswbuild.c:679`).
- **Impact:** (a) new developers cannot bootstrap a local dev DB from
  migrations alone; (b) CI eval workflows that spin up ephemeral
  Postgres containers may be passing only because they bypass some
  migrations, or a future tightening will fail; (c) V20 and later
  migrations cannot be end-to-end validated on a fresh DB until this
  lands.
- **Likely fix path:** Specify a dimension on the embedding column.
  The existing dev DB was already migrated before this bug mattered,
  so the fix needs either (1) a new migration that runs
  `ALTER TABLE ... ALTER COLUMN embedding TYPE vector(N)` and matches
  on the schema_versions hash, or (2) edit V16 with an operator-only
  in-place rehash (risky — the existing DB has a non-null hash
  already). Scope decision required.
- **Status:** RESOLVED 2026-04-21. V16 edited in place to declare
  `embedding vector(1536)` matching text-embedding-3-small (the
  OpenRouter default). The migration runner applies by version number
  and does not re-check checksum, so already-migrated dev DBs are
  unaffected. Fresh DBs migrate V1..V21 cleanly now. NVIDIA
  alternate-dimension support is a separate workstream.

### RepresentationAdminService DI bug in rag:backfill:representations CLI

- **Observed:** 2026-04-21 while attempting the production-path
  representation enrichment trigger for P2.
- **Failure:** CLI bootstrap module fails at DI time with
  `TypeError: Cannot read properties of undefined (reading 'get')` at
  `representation-admin.service.ts:89`. The constructor expects a
  `ConfigService` parameter; the CLI module imports `AppConfigModule`
  but `ConfigService` isn't being injected.
- **Impact:** Cannot enqueue chunks for representation enrichment via
  the production CLI path. P2 wet-run was verified via a direct-insert
  workaround (insert 164 rows with `search_vector=NULL`, run
  `rag:backfill:sparse`), but the production trigger is broken.
- **Likely fix path:** Add `ConfigService` explicitly as a provider
  in the CLI bootstrap module, or import it through a @Global module.
  Investigate why the other backfill CLIs (e.g.
  `rag-backfill-representation-sparse.cli.ts`) don't hit the same
  bug — may already have the fix.
- **Status:** Open.

### `apps/web` full lint is blocked by pre-existing violations

- **Observed:** 2026-04-18 while verifying the Operator Console Timeline UI.
- **Command:** `pnpm --filter @finsentinel/web lint`
- **Failure:** `apps/web/src/context/AuthContext.tsx` violates `react-hooks/set-state-in-effect`; `apps/web/src/lib/rag/__tests__/hybrid-search.test.ts` has an unused `HybridHit` import; `apps/web/src/lib/tauri/__tests__/is-tauri.test.ts` uses explicit `any`.
- **Impact:** Full package lint cannot be used as a clean PR gate for unrelated web UI changes until these files are fixed.
- **Likely fix path:** Fix each lint violation directly and keep future UI PRs using full package lint as the default gate.
- **Status:** Open.

### `packages/db` build config blocks workspace typecheck

- **Observed:** 2026-04-17 while verifying the pi-mono migration plan.
- **Command:** `pnpm typecheck`
- **Failure:** `packages/db/src/apply-migrations.ts` uses `import.meta`, but `packages/db/tsconfig.build.json` compiles with `module: "CommonJS"`, causing TS1343.
- **Impact:** Workspace-wide `pnpm typecheck` cannot be used as a clean migration gate until this is resolved or the migration uses narrower package-level checks.
- **Likely fix path:** Review whether `packages/db` should build as an ES module-compatible target, or move the `import.meta` usage behind a CommonJS-safe helper.
- **Status:** Open.

## 2026-04-17 — carried over from v1.1 hardening

- **[RUNTIME-TD-01] Staging deploy for analysis runtime.** Blocked on credentials.
  Owner: whoever gets staging access. Trigger: before any user-facing flag enable.
- **[RUNTIME-TD-02] Retroactive PR split for v1 push.** 117 commits landed as one
  push on `main`. Cannot rewrite history. Mitigation: use per-plan PRs for v1.2+.
- **[RUNTIME-TD-03] Driver evaluation: postgres.js vs node-postgres.** Mixed-default
  bind bug still present in postgres.js 3.4.9. Current mitigation is the
  insert-all-columns convention (see CLAUDE.md). Decide whether to swap drivers
  when we touch the DB layer again.
- **[RUNTIME-TD-04] Pre-existing silent INSERT failures** (non-v1):
  `user_investment_profiles` auto-create, `agent_brains` auto-create,
  `document_chunks` backfill, `news_items` scheduled fetch, `LocalUserSeeder`
  log claims refresh without verification. All exhibit the same
  postgres.js mixed-default pattern — fix together with RUNTIME-TD-03.
- **[RUNTIME-TD-05] Stale `packages/db/drizzle/` directory.** Auto-generated by
  earlier drizzle-kit workflow; unused after V13. Either delete or put a README
  explaining it is historical.
- **[RUNTIME-TD-06] Integration test infrastructure gaps.** The happy-path spec
  is service-level (direct instantiation + trampoline producer) because the
  existing `test-app.factory.ts` uses a Map-based mock DB incompatible with real
  Drizzle SQL. No fake BullMQ driver exists. HTTP/controller-level integration
  tests (supertest + real worker queue) are still missing. Unblocker: build a
  shared DB+Redis harness with real infra, migrate `test-app.factory` to use it.
- **[RUNTIME-TD-07] Test DB harness duplication.** `analysis-checkpoint.start-stage.spec.ts`
  and `runtime-happy-path.integration.spec.ts` both reinvent the same Drizzle
  client setup, `CI_SKIP_DB_TESTS` guard, and user-seed/teardown pattern. Before
  a third integration test is added, extract into
  `apps/api/src/analysis/__tests__/helpers/db-test-harness.ts`.
- **[RUNTIME-TD-08] Migration runner test coverage gaps.** `apply-migrations.ts`
  unit tests cover parse + filter logic only. Not covered: `listAllMigrations`
  filesystem walk, `--bootstrap-from` bootstrap path, `ensureSchemaVersionsTable`
  detection, V13 file-missing error path, `DATABASE_URL` unset error path.
- **[RUNTIME-TD-09] Hardcoded fallback DB URL in integration specs.**
  `postgresql://postgres:123456@localhost:5432/finsentinel` appears as a fallback
  when `DATABASE_URL` is unset. Move to Vitest `globalSetup` that loads
  `apps/api/.env.test` so credentials come from env only.

## 2026-04-19 — carried over from Phase 1 Team Config Runtime

- **[PHASE1-TD-01] `packages/shared` dist must be rebuilt before API typecheck
  on a fresh checkout.** `apps/api/tsconfig.typecheck.json` resolves
  `@finsentinel/shared` via the compiled `dist/`. When a new export or
  required field lands in `packages/shared/src/` without a follow-up
  `pnpm --filter @finsentinel/shared build`, downstream consumers see TS2353
  errors (e.g. `preset` missing from `CreateRunRequest`). Fix: add
  `@finsentinel/shared#build` as an explicit dependency of
  `@finsentinel/api#typecheck` in `turbo.json`, or bake the build into the
  pre-typecheck hook.
- **[PHASE1-TD-02] `TeamPresetService.maxParallelRoles` is computed but
  unused.** `StageGraphService.build` discards the full `ResolvedPresetPlan`
  and keeps only `stageKeys`. Team services do not thread
  `maxParallelRoles` into role scheduling yet. Either wire it in when role
  scheduling gets reworked, or remove it and re-add when a concrete consumer
  exists. Low priority.
- **[PHASE1-TD-03] `AnalysisCheckpointService.writeOrderDrafts` violates the
  explicit-column rule on `stageId`.** Line ~160 writes
  `stageId: args.stageId ?? undefined` — `undefined` makes Drizzle omit the
  column and fall back to the DB default. The behaviour is correct by accident
  because the DB default is `NULL`. Change to `stageId: args.stageId ?? null`
  to comply with the convention in CLAUDE.md.
- **[PHASE1-TD-04] Generic `ROLE_STARTED/ROLE_COMPLETED/ROLE_FAILED` event
  types are declared but never emitted.** Role-lifecycle events are currently
  emitted under role-specific names (`POSITIVE_CASE_STARTED`, etc.). The
  generic keys were added for Phase 2/3 consumers. If Phase 2 does not
  consume them, either delete or document them as forward-looking.
- **[PHASE1-TD-05] Branch ref drift between worktree and shared repo.**
  The Phase 1 execution dispatched subagents into a worktree at
  `/Users/hongxichen/Desktop/FinSentinel-phase1`. Subagent commits advanced the
  worktree HEAD but not the `phase1/team-config-runtime` branch ref, leaving
  the branch at Task 1.3 while the worktree was at Task 1.5. The first merge
  into `main` pulled only Tasks 1.1–1.3; a second merge was required to pull
  the remaining commits. Future subagent dispatches should either (a) run on
  a non-detached checkout of the target branch, or (b) explicitly advance
  the branch ref after every commit. Document the pattern in the
  subagent-driven-development notes. Applied as a pre-merge guardrail in
  Phase 2 and Phase 3 via `git rev-parse HEAD == git rev-parse <branch>`.

## 2026-04-19 — carried over from Phase 3 Execution Review Ledger

- **[PHASE3-TD-01] `DISPATCHED` status is declared but never written.** The
  `executionReviewLedgerStatusSchema` enum, the V15 SQL `CHECK` constraint,
  and the web `ExecutionReviewLedgerResponse.status` union all list eight
  values including both `DISPATCHED` and `EXECUTED`. In practice
  `ExecutionReviewLedgerService.markDispatched` writes `'EXECUTED'` directly,
  and no code path writes `'DISPATCHED'`. Dead enum value — not a runtime
  defect but an inflated contract surface. Fix options:
  (a) rename `markDispatched` → `markExecuted` and drop `DISPATCHED` from the
  enum + CHECK + union (needs a follow-up migration that widens the CHECK
  first, then narrows it after data is confirmed); or
  (b) introduce a genuine two-step `COMMITTED → DISPATCHED → EXECUTED`
  lifecycle where dispatch records the "hand-off to trading engine" moment
  separately from the confirmed execution.
  Track until a product decision selects between the two.
- **[PHASE3-TD-02] `dispatchManual` loses trading execution details.**
  `ExecutionReviewLedgerService.dispatchManual` records
  `executionResultRef: ledger.commitHash` (the commit hash as a proxy) and
  discards the return value of `trading.execute(userId)`, which contains a
  structured `ExecuteResult` with per-op fill data. Auto-dispatch has the
  same limitation (PHASE3-TD-01 related). Audit-trail gap. Fix: store a
  real execution-result reference (or the JSON-stringified
  `ExecuteResult`) as `executionResultRef`. Low priority until the
  ledger becomes the primary post-trade audit source.
- **[RAG-TD-01] `keyword_entity` representation writes a comma-separated blob at A-weight.**
  `chunk-representation.tsvector.ts` weights the full `keywords.join(', ')` blob
  at setweight A for `keyword_entity` rows, because the LLM response schema in
  `chunk-representation.service.ts:38-54` returns a single flat `keywords` array
  without separating entities / tickers / keywords. Plan R2.2 called for
  A=entities / B=tickers / C=keywords. Closing this requires (a) extending the
  LLM prompt + Zod schema to return separate fields, (b) bumping
  `CURRENT_REPRESENTATION_VERSION` so the idempotency check re-runs old chunks,
  (c) a backfill pass. Scoped outside R2.2 because the fix is prompt + schema +
  version change, not insert-time wiring.
- **[RAG-TD-02] Canonical-chunk tsvector uses `'english'` while representations use `'simple'`.**
  `rag-chunk-store.service.ts:87-95` builds `document_chunks.search_vector` with
  `to_tsvector('english', content)` at B-weight. `chunk-representation.tsvector.ts`
  uses `'simple'` everywhere. `SparseSearchService` probes both with
  `websearch_to_tsquery('simple', …)`. Intentional for Wave 2 (representation
  lane is the clean `'simple'` surface), but stemmer-asymmetric lookups on the
  same query produce different scores on canonical vs representation rows. A
  coordinated migration that switches both sides — and the eval gate — in one
  change can close this once R2.6 shows the benefit justifies the churn.

- **[PHASE3-TD-03] Plan document contains a stale test snippet.**
  `docs/exec-plans/2026-04-18-openalice-remaining-work-plan.md` Task 3.2
  Step 1 still references the pre-fix Drizzle property name
  `orderDraftRefsJson`. The actual implementation uses `orderDraftRefs` per
  commit `997a63a`. Harmless today but misleading for the next reader.
  Fix: update the plan snippet to match the landed code, or note that the
  Drizzle/Zod alignment was done post-hoc.

## 2026-04-20 — carried over from R4.2 review findings

- **[RAG-TD-R4-01] `MetadataPreFilterService` discards sectors[] and regions[] from ExtractedEntities.**
  `buildFilter` iterates only `tickers` and `issuerNames` from the extractor
  result; `sectors: EntityHit<string>[]` and `regions: EntityHit<string>[]`
  are silently dropped. R4.3 will wire the SQL consumption path for
  `SparseSearchFilters.sector` and `.regionId`. At that point, map
  above/below-threshold sector and region hits into the same soft/hard split
  used for tickers / issuers. Until then this is an invisible no-op in the
  LLM-extraction path (the regex path never populates sectors/regions anyway).

- **[RAG-TD-R4-02] `QueryClass` union excludes `colloquial`, but the R4 plan and env defaults reference it.**
  `retrieval-planner.service.ts` defines `QueryClass = 'exact_lookup' | 'factoid' |
  'relational' | 'analytical' | 'multi_part'`. The R4 plan and the default JSON
  for `RAG_METADATA_MIN_CANDIDATES_BY_CLASS` (to be parsed in R4.4) both use a
  `colloquial` bucket that the type system never emits. Without a fix, R4.5's
  guardrail (`minCandidatesByClass[queryClass]`) silently becomes a no-op for
  any traffic that would have been `colloquial` (there is none, because the
  classifier cannot produce it). Two resolutions:
  (a) Add `'colloquial'` to the `QueryClass` union and teach the classifier
      how to emit it; update R4's `MIN_CANDIDATES_BY_CLASS` default to the
      5-class map (drop `colloquial`).
  (b) Strip `colloquial` from the R4 plan text and from any env-default JSON
      in `rag.config.ts` before R4.4 ships.
  Blocks: R4.4 (config wiring) and R4.5 (guardrail). Current workaround: the
  R4.2 spec casts `'colloquial' as any` with a FIXME. Track and resolve before
  R4.4 lands.

- **[RAG-TD-R4-03] Dense lane silently ignores `tickers` / `issuerName` filters.**
  After R4.3, `SparseSearchService` consumes both JSONB filters via
  `(metadata->'tickers') ?| $::text[]` and
  `metadata->>'issuerName' = ANY($::text[])`. The dense lane in
  `RagChunkStoreService.searchRepresentations`
  (`apps/api/src/rag/rag-chunk-store.service.ts`) receives the full
  `SparseSearchFilters` object but its local `RagChunkSearchFilters` type
  omits the two new fields, so they are silently dropped. Impact: a
  high-confidence ticker produces a hard SQL filter on the sparse lane
  but the dense lane retrieves any ticker; the two result sets merge via
  RRF and dense-lane noise dilutes precision on `exact_lookup` queries.
  Fix: add `tickers?: string[]` and `issuerName?: string[]` to
  `RagChunkSearchFilters` and mirror the WHERE clauses in the dense
  lane's SQL builder. Scheduled for a follow-up after R4.5.
- **[RAG-TD-R4-04] `issuerName` metadata key is camelCase; every other
  key is snake_case.**
  `document_chunks.metadata` stores `doc_type`, `sector`, `region_id`,
  `date`, `source_type`, `source_id`, `chunk_index`, `section_path` —
  all snake_case. R4.0c and R4.3 introduce `issuerName` and `tickers`
  with `issuerName` as the lone camelCase key. This is a latent trap:
  a future writer that follows the snake_case convention and writes
  `issuer_name` will silently mismatch the `metadata->>'issuerName'`
  reader in `SparseSearchService`. Fix: either rename to
  `issuer_name` everywhere (writer + reader + backfill) or document
  the exception explicitly in `document-vector.service.ts` +
  `sparse-search.service.ts`. Low effort, zero data-migration risk
  because the key is only days old.
- **[RAG-TD-R4-05] No GIN index on `document_chunks.metadata` for JSONB
  filters.**
  `SparseSearchService` now applies `(metadata->'tickers') ?| ...` and
  `metadata->>'issuerName' = ANY(...)` on the hot path. Migration V9
  creates `document_chunks.metadata` as `jsonb NOT NULL` with no
  functional index. V16 adds GIN on representation `search_vector` but
  not on canonical-chunk `metadata`. Effect: every retrieval call with
  a ticker filter triggers a seq-scan on `document_chunks`. At
  production scale this is not acceptable. Fix: add a V18 migration
  creating `CREATE INDEX document_chunks_metadata_gin_idx ON
  document_chunks USING gin (metadata);` (use `jsonb_ops`, not
  `jsonb_path_ops`, because `?|` requires the full operator class).
  Schedule before Wave 2 ships to production.
- **[RAG-TD-R4-06] Extractor output `docType` and `timeRange` are silently
  discarded by `MetadataPreFilterService.buildFilter`.**
  `QueryEntityExtractorService.regexPass` deterministically extracts
  `docType` (e.g. `'10-K'`, confidence 0.9) and `timeRange`
  (e.g. `FY2024`, confidence 0.95). These fields have obvious SQL
  targets — `SparseSearchFilters.docType` and `.afterDate` — but
  `buildFilter` iterates only `tickers` and `issuerNames` from
  `extracted`, so a query like `"AAPL 10-K FY2024"` restricts only on
  ticker at the SQL layer. Unlike `[RAG-TD-R4-01]` (sectors/regions —
  no reliable regex path), docType and timeRange extraction already
  works end-to-end. Fix: route the two fields through `buildFilter`
  into `hardFilter` when they are above `hardMinConfidence`, merged
  with caller-supplied explicit filters (explicit wins on conflict).
  Impact: the biggest precision miss of R4 on the primary
  `exact_lookup` use case. Schedule alongside `[RAG-TD-R4-03]`.
- **[RAG-TD-R4-07] `PreFilter.softFilter` is computed but never
  consumed.**
  R4.2 landed the soft/hard split per spec: below-threshold hits go
  into `softFilter`. The orchestrator at
  `apps/api/src/rag/retrieval-orchestrator.service.ts` destructures it
  as `softFilter: _soft` and discards it. The plan's stated intent is
  that `softFilter` becomes a per-lane `ORDER BY` boost (non-matching
  rows stay retrievable; matching rows rank higher) — no R4 task
  shipped that. The dead output stays silently ignored until a
  follow-up wires it into sparse ranking. Fix: extend
  `SparseSearchService` to accept `softFilter` and bias `ts_rank_cd`
  via a CASE expression on `metadata->>'issuerName'` etc., or a
  post-fusion re-rank step. Scope with a prototype + eval-delta
  measurement before committing to a design.
- **[RAG-TD-R4-08] LLM fallback invocation rate has no observability.**
  `QueryEntityExtractorService.runLlmFallback` emits no Prometheus
  counter on success. Only the error paths carry a `fallbackFlag`
  (DEBUG log) and the downgrade path has
  `rag_metadata_prefilter_downgrade_total`. When an operator flips
  `RAG_METADATA_LLM_FALLBACK_ENABLED=true` in staging, Grafana cannot
  tell them how often the LLM is actually invoked or at what cost.
  Fix: add `rag_entity_llm_fallback_total{result}` with labels
  `success | empty | timeout | error | circuit_open` at the call site.
  Blocks cost validation for the flag flip.

## 2026-04-20 — carried over from R5 Parser Sidecar

- **[RAG-TD-R5-01] Real parser sidecar replacing the R5 stub.**
  The `services/parser/` sidecar returns fixed Markdown regardless of
  input. Distribution artefacts (Dockerfile, compose service, CI
  workflow, health endpoint) all ship today, but R5 never validates PDF
  extraction quality. Replace the stub with one of: MinerU, pdfplumber +
  heading heuristics, or a commercial OCR API. Blocks: meaningful PDF
  evaluation in Wave 2 eval buckets. Owner + timing: separate work-item.

## 2026-04-21 — carried over from R6 Doc-Type Chunking

- **[RAG-TD-R6-01] Parser-backed PDF/DOCX reindex is deferred.**
  `rag:reindex:by-doctype` can re-chunk text-like documents with the Wave 2
  chunkers, but PDF/DOC/DOCX reindexing needs real parser output. While
  `services/parser/` remains a stub, reindexing those documents would only
  preserve placeholder Markdown. Fix after `[RAG-TD-R5-01]`: route stored
  PDF/DOCX bytes through the real parser sidecar, persist parser metadata, wait
  for representation enrichment to drain, then run the live eval buckets.
