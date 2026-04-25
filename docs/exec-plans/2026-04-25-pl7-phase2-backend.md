# PL-7 Phase 2 Backend Prerequisites — Execution Plan

Date: 2026-04-25
Status: Draft — ready for execution
Owner: hongxichen + Claude
Sources: `docs/exec-plans/2026-04-25-pl7-freshness-badge.md` (phase 1 — merged), `docs/product-specs/2026-04-25-pl7-freshness-badge.md`.

## Background

PL-7 phase 1 shipped freshness badges for Quote and News. The product spec listed
two more surfaces — Citation and Holdings — and phase 1 deferred them because
the responses carry no source timestamp. A third item, the FMP market provider
emitting upstream seconds while Yahoo / Polygon emit milliseconds, was tracked
alongside as a backend cleanup so individual web consumers stop coercing.

This plan delivers all three backend changes that unblock phase 2 frontend
work. It does NOT wire any new badge — that is the next plan
(`docs/exec-plans/2026-04-26-pl7-freshness-badge-phase2.md`, to be drafted
once this one merges).

## Goal

Three independent, low-blast-radius backend changes:

1. **Citation timestamp.** Add an optional `publishedAt` to the citation contract
   and populate it where the source carries one.
2. **Holdings snapshot timestamp.** Add `valuedAt` to `portfolioResponseSchema`
   populated from the per-holding quote freshest-of timestamps.
3. **FMP timestamp unit normalization.** Multiply `quote.timestamp` by 1000 in
   `fmp.provider.ts` so all `MarketQuote.timestamp` values are milliseconds at
   the API boundary.

## Scope

In:

- `packages/shared/src/schemas/analysis.ts` — extend `citationSchema`.
- `apps/api/src/analysis/teams/*.ts` — populate `publishedAt` in the few
  citation-builder call sites.
- `packages/shared/src/schemas/portfolio.ts` — extend `portfolioResponseSchema`.
- `apps/api/src/portfolio/portfolio.service.ts` — populate `valuedAt`.
- `apps/api/src/market/providers/fmp.provider.ts` + matching tests.
- Update `docs/exec-plans/tech-debt-tracker.md` to note phase-2 prerequisites
  unblocked.

Out:

- Frontend badge wiring for Citation / Holdings (next plan).
- Any chunk-level `publishedAt` plumbing through RAG (deferred — citation will
  populate from existing call-site context only).
- Any DB migration. All three changes are schema + service-level only.

## Key decisions

1. **Citation `publishedAt` is optional, not required.** The citation builders
   in `intelligence-team.service.ts`, `risk-team.service.ts`,
   `thesis-team.service.ts`, `execution-prep-team.service.ts`,
   `human-approval-gate.service.ts` create citations from team-internal data
   that may or may not carry a timestamp. Where it does (e.g. news roleOutputs
   carry `publishedAt` per `newsItemResponseSchema`), populate it. Where it
   doesn't, leave it `undefined`. The badge's `Unknown` state already handles
   this gracefully.
2. **Holdings `valuedAt` is derived, not stored.** Compute at response-build
   time as the minimum of quote timestamps used to fill `currentPrice` for
   that response. If no holdings have a quote timestamp, leave `valuedAt`
   `null` — explicit unknown. No DB column added.
3. **FMP normalization belongs in the provider, not the consumer.** Phase 1's
   web-side coercion (`apps/web/src/lib/freshness/quote-timestamp.ts`) stays in
   place as defensive programming, but after this plan lands the API
   contract is "milliseconds" with one provider seam to enforce it. Update
   the existing FMP unit tests; do not add new ones to other providers.

## File structure

```
packages/shared/src/schemas/
  analysis.ts                         (modify — citationSchema + publishedAt)
  portfolio.ts                        (modify — portfolioResponseSchema + valuedAt)

apps/api/src/analysis/teams/
  intelligence-team.service.ts        (modify)
  thesis-team.service.ts              (modify)
  risk-team.service.ts                (modify)
  execution-prep-team.service.ts      (modify)
  human-approval-gate.service.ts      (modify — null-pass through)

apps/api/src/portfolio/
  portfolio.service.ts                (modify — populate valuedAt)
  __tests__/portfolio.service.spec.ts (modify — add 2 cases)

apps/api/src/market/providers/
  fmp.provider.ts                     (modify — *1000 on quote.timestamp)
  __tests__/fmp.provider.spec.ts      (modify — align expected ms)

docs/exec-plans/
  tech-debt-tracker.md                (modify — close 3 entries)
```

---

## Task 1 — Citation `publishedAt`

### 1.1 Schema

`packages/shared/src/schemas/analysis.ts:83`:

```ts
export const citationSchema = z.object({
  artifactId: z.string().optional(),
  url: z.string().url().optional(),
  title: z.string().optional(),
  excerpt: z.string().optional(),
  publishedAt: z.string().datetime().optional(),
});
export type Citation = z.infer<typeof citationSchema>;
```

### 1.2 Builder updates

Locate every site that constructs a citation literal:

```bash
rg -n "citations:\s*\[" apps/api/src/analysis
rg -n "Citation\s*=|: Citation" apps/api/src/analysis
```

For each builder:
- If the citation comes from a news source (typically inside an Intelligence
  role output), pass through `publishedAt` from the upstream
  `NewsItemResponse`.
- Otherwise leave the field unset (`undefined`).

Tests: extend an existing intelligence-team spec so a citation built from a
news item carries `publishedAt`. Don't invent a new spec file.

### 1.3 Verification

- `pnpm --filter @finsentinel/shared build` — PASS.
- `pnpm --filter @finsentinel/api typecheck` — PASS (strict optional
  consumption — every reader either ignores the field or treats it as
  optional).
- `pnpm --filter @finsentinel/api test apps/api/src/analysis/teams/__tests__` — PASS.

### 1.4 Commit

```bash
git commit -m "feat(citation): add optional publishedAt to citationSchema and populate from news sources"
```

---

## Task 2 — Holdings `valuedAt`

### 2.1 Schema

`packages/shared/src/schemas/portfolio.ts:37`:

```ts
export const portfolioResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  totalValue: z.string(),
  holdings: z.array(holdingResponseSchema),
  createdAt: z.string().datetime(),
  valuedAt: z.string().datetime().nullable(),
});
```

`valuedAt` is **nullable**, not optional — it must always appear in the wire
shape so the frontend never has to disambiguate "absent" from "unknown". `null`
is the explicit-unknown signal.

### 2.2 Service population

In `apps/api/src/portfolio/portfolio.service.ts`'s `toPortfolioResponse(...)`
(or equivalent — verify with `rg`):

- The service builds responses by joining `holdings` with the latest quote per
  symbol. Wherever the per-holding `currentPrice` is filled, the same code path
  has the `quote.timestamp` (in milliseconds after Task 3 lands; mixed before).
- Compute `valuedAt = min(quote.timestamp for each filled holding)` then
  `new Date(valuedAt).toISOString()`.
- If no holdings had a quote (empty portfolio, all-failures), set
  `valuedAt: null`.

If the current path drops `quote.timestamp` before reaching response build,
plumb it through. Do NOT add a DB column.

### 2.3 Tests

- New case: portfolio with one holding whose mocked quote returns
  `timestamp = 1714000000000` → response `valuedAt === '2024-04-25T00:26:40.000Z'`.
- New case: portfolio with multiple holdings → `valuedAt` is the minimum.
- New case: portfolio with no quotes → `valuedAt === null`.

### 2.4 Commit

```bash
git commit -m "feat(portfolio): add valuedAt snapshot timestamp derived from quote freshness"
```

---

## Task 3 — FMP timestamp normalization

### 3.1 Source change

`apps/api/src/market/providers/fmp.provider.ts:90`:

```ts
return {
  ticker,
  open: quote.open.toFixed(2),
  high: quote.dayHigh.toFixed(2),
  low: quote.dayLow.toFixed(2),
  close: quote.price.toFixed(2),
  volume: quote.volume,
  timestamp: quote.timestamp * 1000, // FMP returns seconds; normalize to ms
};
```

### 3.2 Test alignment

`apps/api/src/market/__tests__/fmp.provider.spec.ts`:
- Line ~52, ~74: keep mocked upstream `timestamp: 1700245600` (seconds —
  upstream representation).
- Line ~312: assert `timestamp: 1700245600000` (already commented as
  `// seconds * 1000`; the assertion stays correct AFTER the source change).
- Audit any other case in the file that asserts a specific timestamp value
  and update accordingly.

### 3.3 Verification

- `pnpm --filter @finsentinel/api test apps/api/src/market/__tests__/fmp.provider.spec.ts` — PASS.
- `pnpm --filter @finsentinel/api test apps/api/src/market/__tests__` — PASS overall (no other provider should regress; this is a contained change).

### 3.4 Commit

```bash
git commit -m "fix(market/fmp): normalize upstream seconds to milliseconds at provider boundary"
```

---

## Task 4 — Tech-debt tracker close-out

Update `docs/exec-plans/tech-debt-tracker.md`:

- The "PL-7 phase 2 prerequisites" block (added by phase 1) gets three
  sub-bullets crossed off: Citation `publishedAt`, Holdings `valuedAt`, FMP
  normalization. Each crossed-off bullet links to the commit hash.
- Add a forward pointer: "PL-7 phase 2 frontend wiring (Citation +
  Holdings badges) ready to start — see follow-up plan."

```bash
git commit -m "docs(tech-debt): close PL-7 phase-2 backend prerequisites"
```

---

## Verification

Run the full backend suite once at the end:

- `pnpm --filter @finsentinel/shared build` — PASS.
- `pnpm --filter @finsentinel/api typecheck` — PASS.
- `pnpm --filter @finsentinel/api test` — PASS.
- `pnpm --filter @finsentinel/web typecheck` — PASS (re-running because the
  shared schema changed and web consumes it).
- `pnpm --filter @finsentinel/web test` — PASS.

## Risks

- **Citation `publishedAt` propagation gaps.** If a builder reaches a
  citation through a string-only carrier (e.g. just an artifactId), there's
  no timestamp to forward and the field stays empty. Acceptable — phase 2
  badge degrades to Unknown. Do not add chunk lookups solely to populate
  this field; that would expand scope.
- **Holdings `valuedAt` for empty / all-failed quote fetches.** `null` is
  explicit-unknown and the badge handles it. The risk is a behavior change
  in any frontend code that previously assumed a freshly built response is
  always "live" — there is no such code today, but post-merge typecheck
  will catch any breakage.
- **FMP test fixtures.** If any other test asserts `timestamp` for an FMP
  quote at second granularity, it will fail after the change. The plan's
  Task 3.2 audit catches this; subagent must `rg` the entire FMP test
  file, not just the lines listed.

## Progress log

- 2026-04-25: Plan drafted. Three changes are independent and parallelizable
  (no file overlap), so dispatch can fan out across three branches.

## Final outcome

(Filled after merge.)
