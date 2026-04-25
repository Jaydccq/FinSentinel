# PRD: Codebase Optimization Triage (14-axis review)

Date: 2026-04-24
Status: Draft → P0 slice in progress
Owners: hongxichen + Claude

## 0. Purpose

External reviewer raised 14 cross-cutting optimization directions spanning auth, security, trading reliability, financial precision, RAG performance, frontend, DB, CI, and product features. This PRD does NOT redo all of that work — it **triages** each item against existing in-flight plans, identifies real gaps, and assigns priority.

Several reviewer items are partially-addressed by recent PRDs in `docs/product-specs/`. The job here is: (a) confirm what's already covered, (b) name the residual gaps, (c) sequence the work so we don't multi-front high-blast-radius changes.

## 1. Method

For each reviewer item we record:

- **Claim valid?** — yes / partial / no, after reading the code
- **Existing plan** — if already on the radar
- **Residual gap** — what remains after existing plan lands
- **Priority** — P0 (real bug, surgical), P1 (important & bounded), P2 (architectural, multi-week), Defer (out of current scope or speculative)
- **Effort** — XS (≤ 1h), S (≤ 1d), M (≤ 1w), L (multi-week)

## 2. Triage table

| #   | Reviewer item                                                                                                                                                     | Valid?                                                                    | Existing plan                                                                                                                                            | Residual gap                                                                                                                                                                                                                                                   | Priority                                                          | Effort                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------- |
| 1a  | `JwtGuard` reads hardcoded `FS_AUTH`; should read configured name                                                                                                 | ✅ yes                                                                    | `2026-04-23-auth-session-hardening` (explicitly out-of-scope: "no drive-by refactors of jwt.guard")                                                      | Make `JwtGuard` consume `auth.cookie.name` from typed config; add e2e covering custom name                                                                                                                                                                     | **P0**                                                            | XS                    |
| 1b  | `JwtService` casts payload, no Zod validation, no issuer/audience/jti                                                                                             | ✅ yes                                                                    | none                                                                                                                                                     | Add Zod schema for payload; add `iss`/`aud`/`jti` claims; expose interface for future revocation                                                                                                                                                               | **P1**                                                            | S                     |
| 2   | CSRF double-submit token; login rate-limit; failure delay/lockout; refresh+access split; jti blacklist on logout                                                  | ✅ yes                                                                    | none (helmet/cookie-parser already wired in `main.ts` per platform-bootstrap PRD)                                                                        | Whole package: a new "auth-deep-hardening" PRD. Each capability is independently testable                                                                                                                                                                      | **P1** (CSRF, rate-limit) / **P2** (refresh split, jti blacklist) | M                     |
| 3   | Trading execute uses `GETDEL` — failures lose state; need full state machine + order ledger                                                                       | ✅ yes                                                                    | `2026-04-23-trading-stage-commit-execute-atomicity` covers the **stage→commit** race and idempotency hash, NOT the full STAGED→EXECUTING→EXECUTED ledger | New PRD: persistent order ledger + state machine + retryable EXECUTING. Existing P0 PRD lands first; ledger PRD builds on it                                                                                                                                   | **P1**                                                            | M                     |
| 4   | Money/qty as plain `number`; need decimal regex, mutual-exclusion of qty/amount/percentNav, decimal arithmetic                                                    | ✅ yes                                                                    | none                                                                                                                                                     | Tighten `packages/shared/src/schemas/order-draft.ts` Zod; replace `Number()` casts in `paper-broker` and `unified-trading.service.ts`; switch to `decimal.js` or integer-minor-units. Has cross-package blast radius (broker adapters, frontend formatting)    | **P1**                                                            | M                     |
| 5   | Live-trading guards: env+user opt-in, 2FA on first switch, per-order/per-day/per-asset caps, kill switch, market-hours check, persistent order log                | ✅ yes                                                                    | `BrokerRegistry` capability registration exists; `emitTradeEvent` is still a stub                                                                        | New PRD; depends on (3) order ledger and (4) decimal money. **Defer until 3+4 land** to avoid double-touching the same code                                                                                                                                    | **P2** (blocked)                                                  | L                     |
| 6   | RAG: 2048-dim representation seq-scan; eval-driven optimization                                                                                                   | ✅ yes (acknowledged in migration comments)                               | `2026-04-23-rag-fusion-prefilter-shadow-runner` covers fusion weights + metadata pre-filter, NOT dim/index strategy                                      | New design doc: pick canonical-vs-representation tier strategy (1536 HNSW + 2048 rerank, or halfvec, or IVFFlat). Requires eval golden set with real labels (already flagged in `project_rag_upgrade_status`)                                                  | **P2**                                                            | M (post eval-set)     |
| 7   | Embedding client: timeout, retry/backoff, concurrency, dim validation, DLQ                                                                                        | ✅ yes                                                                    | none                                                                                                                                                     | New PRD: thin reliability layer around `EmbeddingClient`. Bounded scope — single class. Easy to land independently                                                                                                                                             | **P1**                                                            | S                     |
| 7b  | Rerank sidecar partial-result fallback to RRF top-up                                                                                                              | ✅ yes                                                                    | none — current behavior is full fallback OR full sidecar                                                                                                 | Small change in `rerank.service.ts`: when sidecar returns < topK, fill remainder from RRF order                                                                                                                                                                | **P1**                                                            | XS                    |
| 8   | RAG eval endpoint: env-flag-only protection insufficient                                                                                                          | ✅ yes                                                                    | none                                                                                                                                                     | Bind to localhost only OR require admin token; add structured logging of eval queries; document in env-schema. Bounded scope — one controller                                                                                                                  | **P0** (security-leaning)                                         | XS                    |
| 9   | Query planner: rules + lightweight classifier hybrid                                                                                                              | ✅ but speculative                                                        | `2026-04-23-rag-fusion-prefilter-shadow-runner` keeps rules; classifier is greenfield                                                                    | Add classifier behind feature flag; emit decision into existing trace. Wait until eval set has real labels — without labels we can't tell if classifier helps                                                                                                  | **Defer**                                                         | M (blocked on labels) |
| 10  | Frontend: typed API client from Zod; SWR/TanStack Query; trading state UI; RAG sources/trace; report progress; env-self-check page; shared form schemas           | ✅ yes                                                                    | partial — Zod schemas already shared via `packages/shared`                                                                                               | New PRD per surface: (a) typed-api-client codegen, (b) SWR rollout, (c) trading-status UI, (d) env-self-check page. Each is independently testable                                                                                                             | **P1** (a, d) / **P2** (b, c)                                     | M                     |
| 11  | Desktop status: experimental vs canonical                                                                                                                         | ✅ yes (CLAUDE.md flags it as canonical-web; root scripts filter desktop) | none — README is mute                                                                                                                                    | One-line README label + CONTRIBUTING note. Cheapest item on the board                                                                                                                                                                                          | **P0** (docs only)                                                | XS                    |
| 12  | Code readability: long minified-looking lines; missing prettier/eslint enforcement                                                                                | ✅ yes                                                                    | none                                                                                                                                                     | Add Prettier config + run; add ESLint `max-lines`/`complexity`/`max-depth`; lint-staged + pre-commit; CI enforce. **Risk:** running prettier on the whole repo creates a megadiff. Strategy: land config first, run on changed files only, gate CI from N+1 PR | **P1**                                                            | S (config) + ongoing  |
| 13  | DB migration tests: fresh, upgrade, EXPLAIN snapshots                                                                                                             | ✅ yes                                                                    | none                                                                                                                                                     | New PRD: `packages/db` adds three Vitest suites + a small EXPLAIN snapshot helper. Useful regression net before doing the RAG-dim or trading-ledger migrations                                                                                                 | **P1**                                                            | M                     |
| 14  | Product-loop features: watchlist triggers, portfolio risk dashboard, citation reports, "what changed since last", trade-from-research, audit log, freshness badge | ✅ yes — but this is product, not engineering                             | none for most                                                                                                                                            | These are 6 separate product PRDs. Triage them in product roadmap, not here. Closest existing artifact: `2026-04-18-high-quality-strategy-engine.md`                                                                                                           | **Defer** to product planning                                     | —                     |

## 3. Sequencing

The blast-radius / dependency view:

```
P0 (this session, surgical):
  1a — JwtGuard cookie name read         ──┐
  8  — RAG eval endpoint scope            ──┼── independent, ship now
  11 — Desktop README label               ──┘

P1 wave 1 (next 1-2 weeks, independent):
  1b — JWT payload Zod + iss/aud/jti
  7  — Embedding reliability layer
  7b — Rerank top-up
  12 — Prettier + ESLint config
  13 — DB migration test harness
  10a/d — Typed API client + env-self-check page

P1 wave 2 (depends on wave 1 patterns):
  2  — CSRF + login rate-limit (CSRF needs typed-client; rate-limit standalone)
  3  — Trading order ledger + state machine
  4  — Decimal money (touches same trading code; coordinate with 3)

P2 (later, larger):
  5  — Live-trading guards (blocked on 3+4)
  6  — RAG dim/index tier strategy (blocked on eval golden set)
  10b/c — SWR rollout, trading-status UI

Defer:
  9  — Query-planner classifier (blocked on eval labels)
  14 — Product-loop features (product roadmap, not eng)
```

## 4. P0 slice — execute now

This PRD ships the three P0 items that are surgical, low-risk, and don't depend on anything else.

### 4.1 P0-A: JwtGuard reads `auth.cookie.name` from typed config

**Files:**

- Modify: `apps/api/src/auth/jwt.guard.ts` — replace hardcoded `'FS_AUTH'` lookup with typed-config read
- Modify: `apps/api/src/auth/auth.module.ts` — confirm `ConfigModule` is in scope (it already is via global config)
- Create: `apps/api/src/auth/__tests__/jwt.guard.spec.ts` — unit test covering bearer header, default cookie, custom cookie name, missing token
- Modify: `apps/api/src/__tests__/integration/auth-flow.integration.spec.ts` — add e2e: set `AUTH_COOKIE_NAME=CUSTOM_AUTH`, login, hit a protected endpoint, assert 200

**Acceptance:**

- Unit test: with `auth.cookie.name = 'CUSTOM_AUTH'`, request carrying `Cookie: CUSTOM_AUTH=<jwt>` resolves user; request carrying `Cookie: FS_AUTH=<jwt>` is rejected.
- Bearer header still works regardless of cookie config.
- Existing integration tests stay green.

### 4.2 P0-B: RAG eval endpoint hardening

**Files:**

- Modify: `apps/api/src/rag/rag-search.controller.ts` — bind to localhost or require admin token (strategy decision: see §5 below)
- Modify: env schema docs / README

**Status:** **Defer to a separate small PR.** Out of this session's scope to keep the diff focused. Ticket: `2026-04-24-rag-eval-endpoint-hardening` (to be drafted).

### 4.3 P0-C: Desktop README label

**Status:** **Defer to a separate small PR.** Pure docs change, no eng coupling, can land any time.

## 5. Open questions for codex / hongxichen

| Q   | Context                                                                                                                                                             | Suggested default                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Should the eval endpoint be (a) localhost-bind only, (b) require admin token, or (c) both?                                                                          | (c) both — defense in depth. Production env should hard-fail if `RAG_EVAL_ENDPOINT_ENABLED=true` AND `NODE_ENV=production` AND no admin token configured. |
| Q2  | For decimal money (item 4), library choice: `decimal.js` (pure JS, slower) vs `big.js` (smaller, slower) vs integer minor-units (no lib, fastest, more discipline)? | `decimal.js` — financial-domain default; rounding rules are explicit; broker adapters already produce decimal strings.                                    |
| Q3  | Item 12 prettier strategy: format-everything-now (megadiff) vs format-on-touch (gradual) vs only-new-code (slowest)?                                                | Format-on-touch with `lint-staged` + a quarterly "drift sweep" PR. Avoids 3000-file diff that breaks blame.                                               |

(Will not block P0-A on these — they're for the wave-1 PRDs.)

## 6. Implementation log

- 2026-04-24 (PRD drafted): P0-A scoped; P0-B and P0-C deferred to separate small PRs.
- 2026-04-24: P0-A executed on branch `fix/2026-04-24-jwt-guard-cookie-name`.

### 2026-04-25 master scorecard

**SHIPPED to main this session and prior (engineering-complete):** 1a JwtGuard cookie name, 1b JWT payload Zod + iss/aud/jti, 7 embedding reliability, 7b rerank top-up, 8 RAG eval localhost-only, 11 desktop README label, 12 prettier sweep, 4 M1-M4 (decimal.js migration end-to-end including broker normalization + frontend form), 3 M1-M3 (order_ledger + state machine + reconciler), 2 M1-M4 (CSRF + rate-limit + refresh+access split + jti revocation), 13 DB migration audit, 10a `/api/health/components` + frontend env self-check page.

**SHIPPED to main after review:** 5 live-trading guards landed via merge commit `8544c71` (PR #14) from `feat/2026-04-25-live-trading-guards`. Review cycle 2 found and fixed the daily-cap race, qty-order preflight pricing, paper-ledger seeding, and a fourth rollback reservation edge (`b0ca52c`). Item 5 is no longer branch-only.

**BLOCKED with named blockers (NOT done tonight):**
- **3 M4** (legacy commitHistory removal): premature — zero production hours of M2/M3, zero operator UI for UNKNOWN_REQUIRES_OPERATOR_REVIEW review, zero audit of read paths still consulting commitHistory. Removing now is self-sabotage.
- **6** (RAG 2048-dim HNSW strategy): blocked on eval golden set with real labels per `2026-04-21-rag-quality-next-steps.md`. Without labels any tier-strategy change is guessing.
- **9** (query planner classifier): same labels block as item 6.
- **10b/c** (frontend SWR / typed-API-client codegen / trading status UI): UX-heavy, design-sensitive, autonomous version would be an unreviewable megabranch. Durable blocker + split path: `tech-debt-tracker.md` entry "Frontend typed-client/SWR/trading-status rollout is blocked on UX state design".
- **14** (product-loop features): explicit product roadmap, not engineering. Split into seven product epics in `docs/product-specs/2026-04-25-product-loop-roadmap-triage.md`.

### Net engineering coverage of the 14-axis triage

- DONE on main: 12 of 14 axes engineering-complete or shipped to the latest planned milestone (1a, 1b, 4, 3 through M3, 2, 5, 7, 7b, 8, 11, 12, 13, 10a).
- Branch-only: 0 axes.
- Blocked: 3 axes (3 M4, 6, 9) blocked on data/soak; 2 axes (10b/c, 14) blocked on design/product input.

The codebase moved from "14 reviewer-flagged axes with mostly PRDs" to "12 axes engineering-shipped or milestone-complete, 5 axis-pieces blocked on data/design/product/soak — each with named recoverable blockers."

### Item 5 — review cycle 2 (2026-04-25, branch only)

External human review of `feat/2026-04-25-live-trading-guards` (commit `7aaf561`) found three issues that the initial self-review missed. All three landed as `8bf58ce` on the same branch:

- **[P1] Failed broker orders permanently consumed daily cap.** `preflight()` reserved the proposed notional via Redis INCRBY but the LIVE loop in `UnifiedTradingService` never called `rollbackDailyReservation()` for failed/partially-filled outcomes. Fix: after the LIVE broker loop, compute realized cents (filledQty × avgPrice for fills, fall back to op.amount for notional-mode, fall back to enriched qty × indicativePrice last; 0 for failures) and roll back `proposed - realized`. Rollback failures log WARN and over-count temporarily until UTC rollover.
- **[P1] qty-only orders bricked by guards.** `TradingGuardsService.preflight` needs `indicativePrice` to compute notional from qty; `UnifiedTradingService` was passing raw `commitData.operations`. With per-order cap > 0 (default $10k): every qty order returned "Cannot determine notional". With per-order cap = 0 (disabled): qty orders bypassed the daily cap entirely. Fix: new `enrichOperationsForPreflight()` helper fetches the close price from `MarketDataService.getQuote` and stamps it as `indicativePrice` BEFORE preflight. Quote-fetch failures leave the op unpriceable (fail-closed).
- **[P2] Paper executions consumed live daily cap.** `seedDailyCounterFromLedger` summed every `EXECUTED` row without filtering broker/trading-mode. Fix: add `ne(orderLedger.broker, 'paper')` to the seed WHERE.

Tests: 6 new UnifiedTradingService-level integration cases wire the REAL `TradingGuardsService` against mock Redis/DB and exercise `execute()` end-to-end through the qty-enrichment + preflight + broker-call + rollback path. Trading suite 244/244 green at land time.

Review cycle 2 is now merged to `main` through PR #14 (`8544c71`). The final branch also included `b0ca52c`, which fixed a fourth edge case: rollback only happens when preflight actually reserved daily-cap budget.

### Remaining blocked items — step-by-step completion playbook

This section is the current map. Detailed execution records live in the linked
artifacts.

#### Item 3 M4 — legacy `commitHistory` removal

Record of detail: `docs/exec-plans/2026-04-24-trading-order-ledger-state-machine.md` ("Still deferred — M4").

Steps:
1. Run M2 + M3 in staging with real broker traffic for at least one week.
   Verify: no unexplained `UNKNOWN_REQUIRES_OPERATOR_REVIEW` pile-up.
2. Audit all production read paths that still consult `wallet.commitHistory`.
   Verify: produce a file/function checklist before changing code.
3. Build or expose an operator review surface for stuck ledger rows.
   Verify: an operator can inspect and resolve UNKNOWN rows without DB access.
4. Migrate history/audit reads to `order_ledger`.
   Verify: behavior-preserving tests compare old commitHistory-shaped results
   with ledger-backed results.
5. Remove the dual-write legacy path.
   Verify: trading tests, integration trading flow, and typecheck pass.

Do not start M4 until steps 1-3 are true.

#### Item 6 — RAG 2048-dim index/tier strategy

Record of detail: `docs/exec-plans/tech-debt-tracker.md` ("Canonical embedding provider = NVIDIA 2048-dim") and `docs/exec-plans/2026-04-21-rag-quality-next-steps.md`.

Steps:
1. Promote or collect a labelled eval set that can measure retrieval quality by
   bucket.
   Verify: eval labels are real enough to distinguish recall/precision changes.
2. Baseline current 2048-dim seq-scan behavior on representative row counts.
   Verify: latency and quality numbers are recorded with dataset size.
3. Compare candidate strategies: keep 2048 seq-scan, IVFFlat, halfvec, or
   1536-index + 2048 rerank tier.
   Verify: each strategy has quality, latency, migration, and rollback notes.
4. Pick one strategy and write a focused execution plan.
   Verify: no index/migration work starts without a chosen acceptance metric.

#### Item 9 — query-planner classifier

Record of detail: `docs/exec-plans/tech-debt-tracker.md` ("Query-planner classifier is blocked on labelled RAG eval data").

Steps:
1. Reuse the same labelled eval set required by item 6.
   Verify: query-class labels or bucket labels exist for classifier evaluation.
2. Define the classifier contract behind a feature flag.
   Verify: trace output records rule decision, classifier decision, and final
   route.
3. Run shadow evaluation against the current rules-only planner.
   Verify: classifier improves the target bucket without degrading overall
   recall/MRR beyond the agreed threshold.
4. Only then implement default-on routing.
   Verify: canary and rollback flags are documented.

#### Item 10b/c — SWR, typed API codegen, trading status UI

Record of detail: `docs/exec-plans/tech-debt-tracker.md` ("Frontend typed-client/SWR/trading-status rollout is blocked on UX state design").

Steps:
1. Split surfaces: typed API codegen, SWR/TanStack rollout, trading status UI.
   Verify: each surface has its own acceptance tests and owner.
2. Design the trading status state model before coding UI.
   Verify: pending/executing/executed/failed/partial/unknown states have copy,
   transitions, retry affordances, and data source defined.
3. Land typed API generation first if it remains P1.
   Verify: generated client and shared Zod schemas agree in typecheck.
4. Roll out SWR/TanStack per page, not globally.
   Verify: no page changes cache semantics without a page-level test.
5. Build trading status UI after the state model is accepted.
   Verify: mocked ledger states render without overlapping or ambiguous actions.

#### Item 14 — product-loop features

Record of detail: `docs/product-specs/2026-04-25-product-loop-roadmap-triage.md`.

Steps:
1. Rank the seven product epics by user workflow value.
   Verify: one epic is selected as the next product PRD, not all six.
2. For the selected epic, write a normal product spec with user story,
   acceptance criteria, data contracts, and non-goals.
   Verify: engineering can estimate it without guessing product behavior.
3. Convert that product spec into an execution plan only after acceptance is
   clear.
   Verify: implementation steps include concrete tests or UI checks.
