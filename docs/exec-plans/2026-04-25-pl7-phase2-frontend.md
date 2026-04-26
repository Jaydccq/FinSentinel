# PL-7 Phase 2 Frontend Wiring — Execution Plan

Date: 2026-04-25
Status: Draft — ready for execution
Owner: hongxichen + Claude
Sources: `docs/exec-plans/2026-04-25-pl7-freshness-badge.md` (phase 1 — merged), `docs/exec-plans/2026-04-25-pl7-phase2-backend.md` (merged), `docs/product-specs/2026-04-25-pl7-freshness-badge.md`.

## Background

Phase 1 shipped Quote and News badges. The phase-2 backend prerequisites
landed (`citationSchema.publishedAt`, `portfolioResponseSchema.valuedAt`,
FMP seconds → ms). Wiring `valuedAt` on `PortfolioService` is currently a TODO
because `PortfolioService` does not call `MarketDataService` today, so all
responses ship with `valuedAt: null`.

Frontend audit before drafting this plan:

- **Citation rendering surface in web does NOT exist today.** `apps/web/src/views/AnalysisPage.tsx` only mounts `ArtifactsPanel` and `FinalReportPanel`; neither lists individual citations. There is no per-citation render hook to attach a badge to. **Decision:** Citation badge is deferred until a citation rendering surface ships in the UI.
- **Holdings rendering surface exists** at `apps/web/src/views/PortfolioPage.tsx` (the holdings table on the portfolio detail view) and `apps/web/src/views/DashboardPage.tsx` (the dashboard summary). Both consume `PortfolioResponse`.

Phase 2 scope for this plan: **Holdings only**. Two halves:

1. **Backend plumbing.** Make `PortfolioService.getPortfolio` and `getPortfolios` fetch quote timestamps and pass them into `toPortfolioResponse`, so `valuedAt` becomes a real ISO timestamp rather than always `null`.
2. **Frontend wiring.** Render `<FreshnessBadge surface="holdings" sourceTimestampMs={…} />` in the holdings table header(s), reading `valuedAt` from the response.

## Goal

Holdings table shows a real-time freshness badge tied to the freshest-of quote
timestamps used to fill `currentPrice` for the row set. When the portfolio has
no holdings or the market service is unavailable, the badge degrades to
Unknown.

## Scope

In:

- `apps/api/src/portfolio/portfolio.service.ts` — fetch quote timestamps via
  `MarketDataService` and pass them to `toPortfolioResponse`. Read paths only
  (`getPortfolio`, `getPortfolios`). Mutation paths
  (`createPortfolio`, `addHolding`, `updateHolding`, `deleteHolding`,
  `removeHolding`) keep `valuedAt: null` — they don't return refreshed
  prices.
- `apps/api/src/portfolio/portfolio.module.ts` — depend on
  `MarketDataModule` (or a forwardRef if circular).
- `apps/api/src/portfolio/__tests__/portfolio.service.spec.ts` — extend with
  cases that assert real `valuedAt` from mocked quote fetches.
- `apps/web/src/views/PortfolioPage.tsx` — render the badge in the holdings
  section header.
- `apps/web/src/views/DashboardPage.tsx` — render the badge in the holdings
  summary header.
- Update tech-debt-tracker: close Holdings sub-gap; record Citation rendering
  prerequisite.

Out:

- Citation badge wiring — no rendering surface to attach to.
- N+1 quote fetches — use `MarketDataService.getQuotes(tickers)` (batch) or a
  single ad-hoc batch loop. If only `getQuote(symbol)` exists, batch via
  `Promise.all` with a hard cap of 50 symbols per call. Document any
  bottleneck observed during tests.
- Re-validating quote freshness inside the service — the MDS already caches.
- Pushing freshness over SSE / WebSocket — phase-3 concern.

## Key decisions

1. **Holdings batch strategy.** `MarketDataService.getQuotes(tickers[])` if it
   exists (subagent verifies). Otherwise wrap `getQuote` with `Promise.all`
   capped at 50 symbols. The cap is paranoid; real portfolios rarely exceed
   20 holdings.
2. **Failure semantics.** If a quote fetch throws for one symbol, that
   timestamp is dropped from the array. `computeValuedAt` already tolerates
   missing entries. If ALL quotes fail, `valuedAt` becomes `null` — same as
   today, badge shows Unknown. Do NOT fail the portfolio response just
   because the market service is degraded.
3. **Cache + batching.** Trust `MarketDataService` to dedupe. Do not cache at
   the portfolio service layer. The subagent must NOT introduce a new cache.
4. **Mutation paths stay null.** Returning `valuedAt: null` after a mutation
   is correct: the response reflects the new holdings row, not a refreshed
   market state. The Holdings badge will briefly show Unknown after mutations,
   then refresh on the next `useSWR` revalidation. Acceptable.
5. **Frontend reads `data.valuedAt` directly.** No new helper. The existing
   `usePortfolio(id)` and `usePortfolios()` hooks already return
   `PortfolioResponse[]`, so `valuedAt` is reachable from the page without
   extra plumbing.

## File structure

```
apps/api/src/portfolio/
  portfolio.service.ts                    (modify — fetch quote timestamps)
  portfolio.module.ts                     (modify — import MarketDataModule)
  __tests__/portfolio.service.spec.ts     (modify — add 3 cases)

apps/web/src/views/
  PortfolioPage.tsx                       (modify — add holdings badge)
  __tests__/PortfolioPage.test.tsx        (modify — add 1 case)
  DashboardPage.tsx                       (modify — add holdings badge)

docs/exec-plans/
  tech-debt-tracker.md                    (modify — close Holdings sub-gap; queue Citation)
```

---

## Task 1 — Backend plumbing

### 1.1 Module dependency

Add `MarketDataModule` to `PortfolioModule.imports`. If the import would be
circular (MarketData → Portfolio for some downstream concern), use
`forwardRef(() => MarketDataModule)` and inject `MarketDataService` with the
matching forwardRef syntax. Subagent verifies the import graph first.

### 1.2 Quote-timestamp fetch in read paths

Modify `getPortfolio(userId, portfolioId)` and `getPortfolios(userId)`:

```ts
// inside getPortfolio
const tickers = holdingRows.map((h) => h.symbol);
const quotes = await Promise.allSettled(
  tickers.slice(0, 50).map((t) => this.marketData.getQuote(t)),
);
const quoteTimestamps = quotes.map((q) =>
  q.status === 'fulfilled' ? q.value.timestamp : null,
);
return this.toPortfolioResponse(row, holdingRows, quoteTimestamps);
```

Apply the same pattern in `getPortfolios` per portfolio. If `MarketDataService`
exposes a batch method, prefer that.

### 1.3 Tests

Mock `MarketDataService.getQuote`:

- One holding, mock returns `timestamp: 1714000000000`. Assert response
  `valuedAt === '2024-04-24T23:06:40.000Z'` (the actual ISO).
- Two holdings with timestamps `1714000000000` and `1714000060000` →
  `valuedAt` is the smaller (`'2024-04-24T23:06:40.000Z'`).
- One holding whose quote fetch rejects → `valuedAt: null`.
- Empty portfolio → `valuedAt: null` (no quote calls).
- Mixed: two holdings, one fulfilled one rejected → `valuedAt` is the
  fulfilled one.

### 1.4 Verification

- `pnpm --filter @finsentinel/shared build` — PASS.
- `pnpm --filter @finsentinel/api typecheck` — PASS.
- `pnpm --filter @finsentinel/api test apps/api/src/portfolio/__tests__/portfolio.service.spec.ts` — PASS (existing + 5 new cases).
- `pnpm --filter @finsentinel/api test --run` — PASS in full.

### 1.5 Commit

```bash
git commit -m "feat(portfolio): fetch quote timestamps to populate response valuedAt"
```

---

## Task 2 — Frontend wiring (PortfolioPage)

### 2.1 Add badge to holdings table header

`apps/web/src/views/PortfolioPage.tsx`:

Above the holdings table, render:

```tsx
{portfolio?.valuedAt != null && (
  <FreshnessBadge
    surface="holdings"
    sourceTimestampMs={Date.parse(portfolio.valuedAt)}
  />
)}
```

If `valuedAt` is `null`, render the badge with `sourceTimestampMs={null}` so
the user sees a Unknown badge — better signal than silent absence.
Subagent picks the cleaner of the two patterns at integration time; both
satisfy the spec.

### 2.2 Test

Render-test the holdings section with a mocked `usePortfolio()` that
returns `{ valuedAt: '2026-04-25T12:00:00.000Z', holdings: […] }`; assert the
badge with `data-status="fresh"` is present (use `vi.setSystemTime` so the
freshness window is deterministic relative to the mocked timestamp).

### 2.3 Commit

```bash
git commit -m "feat(web): add Holdings freshness badge to PortfolioPage"
```

---

## Task 3 — Frontend wiring (DashboardPage)

Mirror Task 2 on the dashboard's holdings summary section. The dashboard may
show multiple portfolios — render one badge per portfolio block, sourcing from
that portfolio's `valuedAt`.

### 3.1 Locate the dashboard's holdings summary section

```bash
rg -n "holdings\|positions" apps/web/src/views/DashboardPage.tsx | head
```

If the dashboard does not currently render per-portfolio holdings (e.g. it
shows aggregate-only data), skip Task 3 and document in the report. The spec
target is "the holdings summary header".

### 3.2 Add the badge inline

Same component pattern as Task 2.

### 3.3 Commit

```bash
git commit -m "feat(web): add Holdings freshness badge to DashboardPage holdings summary"
```

---

## Task 4 — Tech-debt tracker close-out

Update `docs/exec-plans/tech-debt-tracker.md`:

- Close the "Holdings wire-side population still gated on plumbing
  quote.timestamp" sub-gap with the commit hash from Task 1.
- Add a new entry: "PL-7 Citation badge — blocked on web rendering surface":
  - Citation backend (`citationSchema.publishedAt`) is ready.
  - `apps/web/src/views/AnalysisPage.tsx` does not surface individual
    citations today; `ArtifactsPanel` and `FinalReportPanel` are the only
    consumers and neither lists citations.
  - Unblock path: when the analysis UI gains a citations panel, add
    `<FreshnessBadge surface="citation" sourceTimestampMs={…} />` per
    citation row. The config keys are already in
    `apps/web/src/lib/freshness/freshness-config.ts`.

```bash
git commit -m "docs(tech-debt): close PL-7 Holdings sub-gap; queue Citation rendering blocker"
```

---

## Verification

- `pnpm --filter @finsentinel/shared build` — PASS.
- `pnpm --filter @finsentinel/api typecheck` — PASS.
- `pnpm --filter @finsentinel/api test --run` — PASS.
- `pnpm --filter @finsentinel/web typecheck` — PASS.
- `pnpm --filter @finsentinel/web test --run` — PASS.

## Risks

- **Quote fetch latency on portfolio reads.** Adding 1–N quote fetches per
  `getPortfolios` response increases p95 latency. The cap of 50 holdings per
  portfolio bounds the worst case. If the dashboard has many portfolios, p95
  could grow noticeably; revisit if observed. Phase 3 may move quote fetches
  off the response path entirely (precomputed snapshot).
- **MarketDataService availability.** Already handled — failed fetches drop
  into `null` slots and `computeValuedAt` tolerates them.
- **Circular module dependency.** If `MarketDataModule` directly or
  transitively imports `PortfolioModule`, a `forwardRef` is required. Subagent
  verifies and falls back gracefully.
- **DashboardPage might not render holdings.** If it only shows aggregates,
  Task 3 is a no-op; document and move on.

## Progress log

- 2026-04-25: Plan drafted post-audit. Citation deferred — no UI surface
  exists. Holdings full-stack wiring is the only deliverable.

## Final outcome

(Filled after merge.)
