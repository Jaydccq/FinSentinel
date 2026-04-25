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

| # | Reviewer item | Valid? | Existing plan | Residual gap | Priority | Effort |
|---|---|---|---|---|---|---|
| 1a | `JwtGuard` reads hardcoded `FS_AUTH`; should read configured name | ✅ yes | `2026-04-23-auth-session-hardening` (explicitly out-of-scope: "no drive-by refactors of jwt.guard") | Make `JwtGuard` consume `auth.cookie.name` from typed config; add e2e covering custom name | **P0** | XS |
| 1b | `JwtService` casts payload, no Zod validation, no issuer/audience/jti | ✅ yes | none | Add Zod schema for payload; add `iss`/`aud`/`jti` claims; expose interface for future revocation | **P1** | S |
| 2 | CSRF double-submit token; login rate-limit; failure delay/lockout; refresh+access split; jti blacklist on logout | ✅ yes | none (helmet/cookie-parser already wired in `main.ts` per platform-bootstrap PRD) | Whole package: a new "auth-deep-hardening" PRD. Each capability is independently testable | **P1** (CSRF, rate-limit) / **P2** (refresh split, jti blacklist) | M |
| 3 | Trading execute uses `GETDEL` — failures lose state; need full state machine + order ledger | ✅ yes | `2026-04-23-trading-stage-commit-execute-atomicity` covers the **stage→commit** race and idempotency hash, NOT the full STAGED→EXECUTING→EXECUTED ledger | New PRD: persistent order ledger + state machine + retryable EXECUTING. Existing P0 PRD lands first; ledger PRD builds on it | **P1** | M |
| 4 | Money/qty as plain `number`; need decimal regex, mutual-exclusion of qty/amount/percentNav, decimal arithmetic | ✅ yes | none | Tighten `packages/shared/src/schemas/order-draft.ts` Zod; replace `Number()` casts in `paper-broker` and `unified-trading.service.ts`; switch to `decimal.js` or integer-minor-units. Has cross-package blast radius (broker adapters, frontend formatting) | **P1** | M |
| 5 | Live-trading guards: env+user opt-in, 2FA on first switch, per-order/per-day/per-asset caps, kill switch, market-hours check, persistent order log | ✅ yes | `BrokerRegistry` capability registration exists; `emitTradeEvent` is still a stub | New PRD; depends on (3) order ledger and (4) decimal money. **Defer until 3+4 land** to avoid double-touching the same code | **P2** (blocked) | L |
| 6 | RAG: 2048-dim representation seq-scan; eval-driven optimization | ✅ yes (acknowledged in migration comments) | `2026-04-23-rag-fusion-prefilter-shadow-runner` covers fusion weights + metadata pre-filter, NOT dim/index strategy | New design doc: pick canonical-vs-representation tier strategy (1536 HNSW + 2048 rerank, or halfvec, or IVFFlat). Requires eval golden set with real labels (already flagged in `project_rag_upgrade_status`) | **P2** | M (post eval-set) |
| 7 | Embedding client: timeout, retry/backoff, concurrency, dim validation, DLQ | ✅ yes | none | New PRD: thin reliability layer around `EmbeddingClient`. Bounded scope — single class. Easy to land independently | **P1** | S |
| 7b | Rerank sidecar partial-result fallback to RRF top-up | ✅ yes | none — current behavior is full fallback OR full sidecar | Small change in `rerank.service.ts`: when sidecar returns < topK, fill remainder from RRF order | **P1** | XS |
| 8 | RAG eval endpoint: env-flag-only protection insufficient | ✅ yes | none | Bind to localhost only OR require admin token; add structured logging of eval queries; document in env-schema. Bounded scope — one controller | **P0** (security-leaning) | XS |
| 9 | Query planner: rules + lightweight classifier hybrid | ✅ but speculative | `2026-04-23-rag-fusion-prefilter-shadow-runner` keeps rules; classifier is greenfield | Add classifier behind feature flag; emit decision into existing trace. Wait until eval set has real labels — without labels we can't tell if classifier helps | **Defer** | M (blocked on labels) |
| 10 | Frontend: typed API client from Zod; SWR/TanStack Query; trading state UI; RAG sources/trace; report progress; env-self-check page; shared form schemas | ✅ yes | partial — Zod schemas already shared via `packages/shared` | New PRD per surface: (a) typed-api-client codegen, (b) SWR rollout, (c) trading-status UI, (d) env-self-check page. Each is independently testable | **P1** (a, d) / **P2** (b, c) | M |
| 11 | Desktop status: experimental vs canonical | ✅ yes (CLAUDE.md flags it as canonical-web; root scripts filter desktop) | none — README is mute | One-line README label + CONTRIBUTING note. Cheapest item on the board | **P0** (docs only) | XS |
| 12 | Code readability: long minified-looking lines; missing prettier/eslint enforcement | ✅ yes | none | Add Prettier config + run; add ESLint `max-lines`/`complexity`/`max-depth`; lint-staged + pre-commit; CI enforce. **Risk:** running prettier on the whole repo creates a megadiff. Strategy: land config first, run on changed files only, gate CI from N+1 PR | **P1** | S (config) + ongoing |
| 13 | DB migration tests: fresh, upgrade, EXPLAIN snapshots | ✅ yes | none | New PRD: `packages/db` adds three Vitest suites + a small EXPLAIN snapshot helper. Useful regression net before doing the RAG-dim or trading-ledger migrations | **P1** | M |
| 14 | Product-loop features: watchlist triggers, portfolio risk dashboard, citation reports, "what changed since last", trade-from-research, audit log, freshness badge | ✅ yes — but this is product, not engineering | none for most | These are 6 separate product PRDs. Triage them in product roadmap, not here. Closest existing artifact: `2026-04-18-high-quality-strategy-engine.md` | **Defer** to product planning | — |

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

| Q | Context | Suggested default |
|---|---|---|
| Q1 | Should the eval endpoint be (a) localhost-bind only, (b) require admin token, or (c) both? | (c) both — defense in depth. Production env should hard-fail if `RAG_EVAL_ENDPOINT_ENABLED=true` AND `NODE_ENV=production` AND no admin token configured. |
| Q2 | For decimal money (item 4), library choice: `decimal.js` (pure JS, slower) vs `big.js` (smaller, slower) vs integer minor-units (no lib, fastest, more discipline)? | `decimal.js` — financial-domain default; rounding rules are explicit; broker adapters already produce decimal strings. |
| Q3 | Item 12 prettier strategy: format-everything-now (megadiff) vs format-on-touch (gradual) vs only-new-code (slowest)? | Format-on-touch with `lint-staged` + a quarterly "drift sweep" PR. Avoids 3000-file diff that breaks blame. |

(Will not block P0-A on these — they're for the wave-1 PRDs.)

## 6. Implementation log

- 2026-04-24 (now): PRD drafted; P0-A scoped; P0-B and P0-C deferred to separate small PRs.
- 2026-04-24: P0-A executed on branch `fix/2026-04-24-jwt-guard-cookie-name`.
