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
  - numbers.

  **Follow-up items (all either CLOSED or documented):**
  1. **chunk_id remapping** — CLOSED 2026-04-21 via
     `run_evaluation.py:_coerce_chunk`.
  2. **Provenance** — PARTIALLY ADDRESSED 2026-04-21. 30 of 100
     queries rewritten into natural conversational phrasings
     (provenance_label=`natural_phrasing_synthetic`); remaining 70
     stay `reverse_engineered_synthetic`. True real-user promotion
     (from `rag_query_logs` / `chat_messages`) still requires a
     populated source. See `golden.meta.json` v2.1.
     - **2026-04-25 update:** Promotion CLI now exists at
       `pnpm --filter @finsentinel/api rag:eval:promote` (source
       `apps/api/src/rag/eval/rag-promote-eval.cli.ts`). Real
       promotion can begin as soon as `rag_query_logs` carries
       enough representative traffic AND `rag.queryLog.piiEnabled`
       is set in the staging window so `query_preview` is non-NULL.
       Operator steps in
       `docs/runbooks/2026-04-25-rag-eval-promotion-runbook.md`.
       Phase 1 ships tooling only — reviewer-driven promotion of
       actual rows is a separate operational PR.
     - **2026-04-26 local staging proof:** Seeded the fixture corpus into
       local Postgres and inserted 100 synthetic query-log rows derived from
       the current golden queries. `rag:eval:promote --dry-run` sampled 58
       rows with `without_preview=0`, and a live run to `/tmp` produced 58
       review rows.
     - **2026-04-26 real-API trace path verified:** Two
       `RagTraceService` array-binding bugs were exposed while running the
       local API with `RAG_QUERY_LOG_PII_ENABLED=true` and fixed:
       (a) empty arrays → `c0f1b94`, (b) non-empty arrays were emitting a
       SQL row tuple instead of `ARRAY[...]::<type>[]` → `b7d410a`. After
       the fix, 10 real-API search queries produced 10 well-formed
       `rag_query_logs` rows; `rag:eval:promote` then sampled 30 of them
       across 6 classes into `/tmp/local-rag-promote-golden-v2.json` with
       real chunk UUIDs and `provenance_label = real_user_promoted`. The
       trace pipeline is now load-bearing for promotion — staging will
       use the same path with a different `DATABASE_URL`. Real-traffic-
       promoted rows still require human PII / quality review before
       they can move into the canonical
       `services/evaluation-runner/datasets/golden.json`.
     - **2026-04-26 review batch:** A clean local API window generated
       165 trace rows after fixing the embedding-provider environment;
       all 165 had previews and non-empty chunk ids. Promotion dry-run
       sampled 100 rows, 20 each for exact_lookup / factoid / relational /
       analytical / multi_part, and live output was written to
       `/tmp/staging-rag-promote.json`. Automated PII regex checks passed,
       but canonical promotion remains blocked because the rows use the
       current retrieval output as labels rather than reviewer-confirmed
       ground-truth chunks.
     - **2026-04-26 v2.2 canonical promotion:** Operator explicitly accepted
       Codex-owned review instead of waiting for separate human annotation.
       `services/evaluation-runner/build_golden_v22_review.mjs` converted
       promoted result UUIDs to corpus chunk ids, selected ground-truth
       `expected_chunk_ids` from `corpus.json`, repaired 14 mismatched
       existing golden rows, and wrote canonical
       `golden.json` / `golden.meta.json` v2.2 with 200 labelled entries.
       Validation found 0 missing chunk references, 0 empty labels, 0 empty
       answers, and 0 regex-detectable PII hits; offline eval on the canonical
       set recorded strict recall@5=0.7985 and strict recall@10=0.9142.
       Under this operator decision, item 6 2048-dim tier evaluation and item
       9 query-planner classifier shadow evaluation are unblocked locally.
       Future externally reviewed staging labels should record their own
       reviewer provenance rather than overwriting this history.
  3. **Query rewrite / HyDE eval timeout** — CLOSED 2026-04-21.
     `fetch_retrieval_results` now accepts `timeout_s` via config
     `retrieval.timeout_s` or env `RAG_EVAL_TIMEOUT_S`; default 30s,
     bump to 120+ for rewrite-on runs. +1 test.
  4. **Reranker sidecar** — CLOSED 2026-04-21. `services/reranker/`
     brought up locally on :8100 with the `BAAI/bge-reranker-v2-m3`
     model loaded via the bundled uvicorn. Orchestrator's rerank
     stage now uses the BGE cross-encoder instead of the RRF
     fallback when the sidecar is reachable.
  5. **Docker image build** — CLOSED 2026-04-21.
     `finsentinel/parser:p4` image built locally (152 MB), runs via
     `docker run -p 8110:8110 finsentinel/parser:p4`, verified by
     parsing a real PDF fixture end-to-end inside the container.
  6. **RepresentationAdminService DI bug** — CLOSED 2026-04-21.
     `RepresentationAdminService` and `RepresentationEnrichProducer`
     now declare explicit `@Inject(ConfigService)` on their
     constructor params. Also fixed a BullMQ 5.71 validation
     regression (`:` in jobId), renaming to `rep-enrich-<chunkId>`.
     Production enrichment path now works end-to-end against a
     local Redis + apps/api.
  7. **Canonical embedding provider = NVIDIA 2048-dim.** User
     decision 2026-04-21: standardise on `nvidia/llama-nemotron-
embed-1b-v2` going forward. V16 rewritten to declare
     `embedding vector(2048)` directly (no HNSW — pgvector caps
     at 2000 dims), `STUB_EMBEDDING_DIM` in `seed-fixture.cli.ts` is
     2048, `chunk-representation.service.spec.ts` +
     `chunk-representation.service.sparse.spec.ts` mocks emit 2048-dim
     vectors. V22 stays as a bridge for DBs that applied the older
     `vector(1536)` V16 revision. Dense representation-lane retrieval
     runs seq-scan (fine at current scale; swap to IVFFlat if the
     representation row count grows past a few hundred thousand).

### V16 migration fails on a fresh DB — RESOLVED 2026-04-21

- **Observed:** 2026-04-21 while attempting to apply migrations to a
  fresh `finsentinel_test` DB to validate V20 (GIN index) for P3.4 of
  `docs/exec-plans/2026-04-21-rag-quality-next-steps.md`.
- **Command:** `DATABASE_URL=... pnpm --filter @finsentinel/db db:migrate`
- **Failure:** V16 declares
  `document_chunk_representations.embedding vector` without a dimension
  (`vector` not `vector(2048)`), then tries to create
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
  `embedding vector(2048)` matching the canonical NVIDIA provider
  (`nvidia/llama-nemotron-embed-1b-v2`), with no HNSW index (pgvector
  HNSW caps at 2000 dims). V22 is a bridge migration for DBs that
  applied an earlier revision (which had `vector(1536)` + HNSW); it
  drops the index and widens the column, and is idempotent on DBs
  that applied the current V16 directly. The migration runner applies
  by version number and does not re-check checksum, so already-
  migrated dev DBs skip the edited V16 and rely on V22.

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

### Query-planner classifier is blocked on labelled RAG eval data

- **Observed:** 2026-04-25 while cleaning up the 14-axis triage records.
- **Evidence:** `docs/exec-plans/2026-04-24-codebase-optimization-triage-prd.md`
  item 9 proposes a rules + lightweight-classifier hybrid, but the current
  durable RAG quality records require labelled eval data before quality claims
  are meaningful. The existing planner work in
  `docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md` already
  has rule-based query classes and traceable routing.
- **Impact:** Adding a classifier now would create a new routing surface without
  a trustworthy way to prove it improves recall, precision, or latency.
- **Likely fix path:**
  1. Reuse the labelled eval set required by the RAG 2048-dim strategy work.
  2. Define a feature-flagged classifier contract that emits both the rules
     decision and classifier decision into the existing trace.
  3. Run shadow evaluation against rules-only routing.
  4. Promote only if the labelled set shows a bucket-level win with no overall
     regression.
- **Status:** Phase 1 (offline shadow eval) closed 2026-04-26.
  - Plan: `docs/exec-plans/2026-04-26-query-classifier-shadow-phase1.md`.
  - Shipped: pure rule classifier extracted to
    `apps/api/src/rag/query-classifier-rules.ts`; sibling
    `LlmQueryClassifierService` in
    `apps/api/src/rag/query-classifier-llm.ts`; offline runner
    `services/evaluation-runner/run_classifier_shadow.mjs` against golden v2.2.
  - First shadow numbers (rules-only, 200 entries):
    accuracy_overall=0.385; vocabulary_gap blast radius 28
    (`summary`, `numeric` not emitted by rules); top confusion
    `relational→factoid` (21), `relational→analytical` (17),
    `factoid→exact_lookup` (14). Report path
    `services/evaluation-runner/reports/classifier-shadow-<ISO>.json`
    (gitignored — regenerate locally).
  - First LLM numbers (`openai/gpt-4o-mini`, 200 entries, single full run):
    accuracy_overall=0.385 (TIE with rules); LLM gains precision on
    `factoid` (0.86 vs 0.36) and `relational` (0.87 vs 0.73), but loses
    recall on `relational` and trades into `analytical` heavily.
    Total tokens 79,885; ~$0.02 at gpt-4o-mini list.
  - Phase 2 still OPEN: runtime shadow path under
    `RAG_QUERY_CLASSIFIER_SHADOW_ENABLED`. Promotion gates (locked in
    here so the next attempt is mechanical):
    - ≥ 5 pp absolute precision improvement on at least one bucket, OR
    - ≥ 2 pp overall accuracy with no per-bucket regression > 1 pp.
    The current single LLM run does NOT meet either gate; either tune the
    prompt / model OR extend rule vocabulary to include `numeric` /
    `summary` (a deliberate planner-policy decision, not a Phase 2
    shortcut) before re-running shadow.

### Frontend typed-client/SWR/trading-status rollout is blocked on UX state design

- **Observed:** 2026-04-25 while cleaning up the 14-axis triage records.
- **Evidence:** `docs/exec-plans/2026-04-24-codebase-optimization-triage-prd.md`
  item 10 groups typed API client generation, SWR/TanStack Query rollout, and
  trading status UI. Item 10a (`/api/health/components` + env self-check page)
  has shipped, but 10b/c still combines API shape, caching semantics, and
  money-path UI states.
- **Impact:** Implementing all remaining frontend work in one branch would
  couple generated-client churn, cache behavior changes, and trading ledger UI
  decisions. The result would be hard to review and risky to regress.
- **Likely fix path:**
  1. Split the work into three execution plans: typed API codegen, page-scoped
     SWR/TanStack rollout, and trading status UI.
  2. Define the trading status state model before UI implementation:
     `pending`, `executing`, `executed`, `partially_failed`, `failed`,
     `unknown_requires_operator_review`, plus retry/acknowledgement behavior.
  3. Land typed API generation first if it remains the highest-value P1.
  4. Roll out cache changes per page with page-level tests.
- **Status:** Typed API codegen — phase 1 landed (2026-04-25 on
  `feat/2026-04-25-typed-api-codegen`):
  - `apps/web/src/api/typed-client.ts` wraps `apiFetch` with Zod request +
    response validation, surfaces drift as `ResponseValidationError`.
  - `apps/web/src/api/registry.ts` binds `(path, method)` descriptors to
    shared `@finsentinel/shared` schemas.
  - 3 client modules migrated: `watchlist.ts`, `auth.ts`, `portfolio.ts`
    (CRUD surface only — holdings/analytics/insights/reports stay on raw
    `apiFetch` for now).
  - 16 client modules still on raw `apiFetch`, pending follow-up phases:
    `analysis.ts`, `analysis-approvals.ts`, `analysis-runs.ts`,
    `autonomy.ts`, `chat.ts`, `documents.ts`, `events.ts`, `market.ts`,
    `news.ts`, `okx.ts`, `reports.ts`, `research.ts`, `settings.ts`,
    `trading.ts`, plus the holdings/analytics/insights tail of
    `portfolio.ts`. SWR rollout and trading-status UI remain blocked on
    UX/state-model input.
- **Status update (2026-04-25):** SWR phase 1 landed for portfolio +
  watchlist on `feat/2026-04-25-swr-rollout-phase1`:
  - `swr@^2` added to `apps/web`; global `SWRConfig` (dedupe 2s, no
    focus revalidation, two retries) wraps the app in
    `apps/web/src/providers.tsx`.
  - New hooks under `apps/web/src/hooks/api/`: `usePortfolios`,
    `usePortfolio`, `useWatchlist` (with `save`/`updateItem`/`deleteItem`
    wrappers that revalidate on success).
  - `PortfolioPage` migrated from `useEffect + setState` to
    `usePortfolios()`; `WatchlistItemEditor` migrated to `useWatchlist()`.
  - Plan deviation: `usePortfolioPositions` was dropped — `portfolioApi`
    has no `positions` method; holdings are nested in the portfolio
    response. The watchlist page route does not exist, so the
    `WatchlistItemEditor` component was the migrated surface.
  - Remaining 14 pages still on raw `useEffect + setState`
    (chat, analysis, news, market, reports, autonomy, dashboard,
    documents, env-self-check, settings, stock, trading, crypto,
    private-docs). Trading status UI remains blocked on UX state design
    (see next plan).
- **Status update (2026-04-25):** Trading status UI phase 1 landed on
  `feat/2026-04-25-trading-status-ui-phase1`:
  - State model anchored to the actual `order_ledger.status` enum
    (`STAGED | COMMITTED | EXECUTING | EXECUTED | PARTIALLY_FAILED |
    FAILED | CANCELLED | UNKNOWN_REQUIRES_OPERATOR_REVIEW`) instead of
    the plan's invented names. Single source of truth lives at
    `apps/web/src/lib/trading/order-status-copy.ts`.
  - New backend read endpoint `GET /api/trading/ledger?limit=N` (max
    50, default 25) backed by `OrderLedgerService.findRecentByUser`.
    Wire format mirrored in `@finsentinel/shared`
    (`orderLedgerListResponseSchema`).
  - New web surfaces: `OrderStatusBadge`, `OrderLedgerCard`,
    `RecentOrdersSection` rendered on `views/TradingPage.tsx` (Paper
    tab); SWR-backed `useOrderLedger` hook polls every 10s.
  - Phase 1 is read-only. Retry / Acknowledge buttons render `disabled`
    with a `title="Coming in phase 2"` tooltip. Wiring is blocked on
    item 3 M4 (operator-action backend).
  - Plan deviations: status enum names corrected to match the SQL CHECK
    (no `PENDING` / `PARTIALLY_FILLED`); copy module covers all 8 real
    enum values; backend ledger read endpoint added (the plan assumed
    one already existed).
  - Verification: `pnpm --filter @finsentinel/web typecheck` PASS,
    `pnpm --filter @finsentinel/web test` 134/134 PASS,
    `pnpm --filter @finsentinel/api typecheck` PASS,
    `pnpm --filter @finsentinel/api test` 1752/1752 PASS (1 skipped).

### `apps/web` full lint — RESOLVED 2026-04-25

- **Originally observed:** 2026-04-18 while verifying the Operator Console Timeline UI.
- **Cited violations:**
  - `apps/web/src/context/AuthContext.tsx` `react-hooks/set-state-in-effect`
  - `apps/web/src/lib/rag/__tests__/hybrid-search.test.ts` unused `HybridHit`
  - `apps/web/src/lib/tauri/__tests__/is-tauri.test.ts` explicit `any`
- **Audit 2026-04-25:** `pnpm --filter @finsentinel/web lint` exits 0 with
  zero output. `HybridHit` is actively consumed by `assertHybridHitShape` in
  the rag hybrid-search test. The other two violations were quietly fixed
  by intermediate PRs without updating this entry. No code change needed.
- **Status:** Closed.

### `packages/db` build config blocks workspace typecheck

- **Observed:** 2026-04-17 while verifying the pi-mono migration plan.
- **Command:** `pnpm typecheck`
- **Failure:** `packages/db/src/apply-migrations.ts` uses `import.meta`, but `packages/db/tsconfig.build.json` compiles with `module: "CommonJS"`, causing TS1343.
- **Impact:** Workspace-wide `pnpm typecheck` cannot be used as a clean migration gate until this is resolved or the migration uses narrower package-level checks.
- **Likely fix path:** Review whether `packages/db` should build as an ES module-compatible target, or move the `import.meta` usage behind a CommonJS-safe helper.
- **Status:** Open.

### PL-7 Freshness Badge phase 1 landed

- **Observed:** 2026-04-25 while shipping `feat/2026-04-25-pl7-freshness-badge-phase1`.
- **Plan:** `docs/exec-plans/2026-04-25-pl7-freshness-badge.md`.
- **What landed:** Quote (`apps/web/src/views/StockDetailPage.tsx`) and News
  (`apps/web/src/views/NewsPage.tsx`) surfaces now render `<FreshnessBadge>`.
  Per-surface thresholds in `apps/web/src/lib/freshness/freshness-config.ts`.
  Pure state computation in `freshness-state.ts`. Visibility-aware
  `useFreshnessNow()` ticker. Local `freshness-logger.ts` shim emits one
  `freshness.render` console event per render — replace when an
  observability module lands.
- **What is intentionally not solved here:** `marketQuoteSchema.timestamp`
  is mixed seconds (FMP) / ms (Yahoo, Polygon). Phase 1 normalizes
  defensively in `apps/web/src/lib/freshness/quote-timestamp.ts`. The
  right long-term fix is provider-side normalization in
  `apps/api/src/market/providers/fmp.provider.ts:90` (multiply by 1000).
  Tracked separately under "PL-7 phase 2 prerequisites".
- **Status:** Closed (phase 1).

### PL-7 phase 2 prerequisites — Citation and Holdings need source timestamps

- **Observed:** 2026-04-25 during the PL-7 source-timestamp audit (see plan
  background section).
- **Plan:** `docs/exec-plans/2026-04-25-pl7-phase2-backend.md` (drafted and
  shipped 2026-04-25); `docs/exec-plans/2026-04-25-pl7-phase2-frontend.md`
  (drafted and shipped 2026-04-25).
- **Citation gap:** ~~`citationSchema` has no timestamp field~~ → CLOSED 2026-04-25
  via commit `c265be6`. `citationSchema` now has optional
  `publishedAt: z.string().datetime().optional()`. Citation builders propagate
  the field end-to-end via `RoleExecutorService.parseStructured()` →
  `flatMap` into team output; LLM-emitted `publishedAt` flows through
  without per-team plumbing changes.
- **Holdings gap:** ~~`portfolioResponseSchema` lacks a snapshot timestamp~~ →
  CLOSED 2026-04-25 via commits `132d944` (schema + helper) and `e78de9f`
  (wire-side plumbing). `portfolioResponseSchema` has nullable
  `valuedAt: z.string().datetime().nullable()`.
  `PortfolioService.computeValuedAt(timestamps[])` helper has defensive
  seconds→ms coerce, freshest-of min, null on empty.
  Read paths (`getPortfolio`, `getPortfolios`) now call
  `MarketDataService.getQuote` per holding via `Promise.allSettled`
  (capped at 50 symbols) and pass the timestamps into
  `toPortfolioResponse`. Failed quotes degrade to null without breaking
  the response. Mutation paths intentionally keep `valuedAt: null` —
  those responses reflect the new holdings row, not refreshed market
  state, and the badge will briefly show Unknown until the next SWR
  revalidation.
- **Provider-side timestamp normalization:** ~~`fmp.provider.ts:90` emits
  seconds~~ → CLOSED 2026-04-25 via commit `b58838d`. FMP now multiplies
  upstream timestamp by 1000 at the provider boundary; all providers emit
  ms uniformly. The web defensive coerce in
  `apps/web/src/lib/freshness/quote-timestamp.ts` stays for now (cheap
  belt-and-braces) and can be removed in a later cleanup once we trust
  the provider contract has held.
- **Frontend wiring:** Holdings badge landed 2026-04-25 via commit
  `c4b2b66` on `apps/web/src/views/PortfolioPage.tsx` — renders inline
  with the per-portfolio "Holdings" header on the expanded view, sourced
  from `PortfolioResponse.valuedAt`. DashboardPage was intentionally
  skipped: it shows aggregate per-portfolio data (totalValue, holdings
  count) but does not render holdings rows, so the spec target ("the
  holdings summary header") does not exist there. Citation badge stays
  deferred — see next entry.
- **Status:** Closed. Backend prerequisites + Holdings frontend wiring
  all in. Citation badge tracked separately below.

### PL-7 Citation badge — RESOLVED 2026-04-25

- **Originally observed:** 2026-04-25 during PL-7 phase 2 frontend audit.
- **Backend prerequisite:** `citationSchema.publishedAt` landed via
  commit `c265be6`.
- **Frontend landing:** `feat/2026-04-25-citations-panel` adds a
  `CitationsPanel` that lists citations grouped by stage with a
  `<FreshnessBadge surface="citation" />` per row. Mounted on
  `AnalysisPage.tsx` between `ArtifactsPanel` and `FinalReportPanel`.
  - `apps/web/src/components/analysis/CitationsPanel.tsx` (new)
    — commit `621cd5a`.
  - `apps/web/src/views/AnalysisPage.tsx` mount + render-test
    — commit `5ffefde`.
  - `apps/web/src/api/analysis-runs.ts` tightened
    `AnalysisStageResponse.structuredOutput` to the shared
    `StageStructuredOutput` shape so the panel can read
    `stage.structuredOutput?.citations` without a cast
    — commit `e649373`.
- **Surface decisions:**
  - Per-stage grouping (matches the analysis page mental model).
  - Always-render badge: missing `publishedAt` → `Unknown` badge so the
    trust signal is never silently dropped.
  - No de-duplication across stages in v1 — phase 2 may dedupe.
- **Status:** Closed.

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
