# PL-7 Freshness Badge — Engineering Execution Plan (v1)

Date: 2026-04-25
Status: Draft — ready for execution
Owner: hongxichen + Claude
Source spec: `docs/product-specs/2026-04-25-pl7-freshness-badge.md`

## Background

The product spec for PL-7 named four target surfaces — Quote, News, Citation, Holdings.
This plan opens with a source-timestamp audit and then writes the implementation
strategy against what actually exists.

### Source-timestamp audit (2026-04-25)

| Surface   | Spec assumption                                      | Actual schema today                                                                                              | Verdict for v1                                          |
| --------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Quote     | `quoteResponse.lastTradedAt` (ISO string)            | `marketQuoteSchema.timestamp: z.number().int()` (epoch) — `packages/shared/src/schemas/market.ts:11`             | **In** — adapter converts epoch → Date.                  |
| News      | `newsItem.publishedAt` (ISO string)                  | `newsItemResponseSchema.publishedAt: z.string().datetime()` — `packages/shared/src/schemas/news.ts:15`           | **In** — direct mapping.                                 |
| Citation  | `citation.documentMetadata.publishedAt` (ISO string) | `citationSchema` = `{ artifactId?, url?, title?, excerpt? }` — `packages/shared/src/schemas/analysis.ts:83-89`. **No timestamp.** | **Out (phase 2)** — backend prerequisite missing.        |
| Holdings  | `portfolioResponse.snapshot.asOf`                    | `portfolioResponseSchema.createdAt` is creation, not as-of. `holdingResponseSchema.currentPrice` is untimestamped. — `packages/shared/src/schemas/portfolio.ts:25-45` | **Out (phase 2)** — backend prerequisite missing.        |

### v1 scope decision

Ship Quote + News in v1. Cite the Citation/Holdings backend gap as a documented
phase-2 prerequisite in the tech-debt tracker. Doing all four in one PR would
require schema changes across `apps/api/src/rag/`, `apps/api/src/portfolio/`,
their controllers, and a backfill or aggregation pass — that is a separate
engineering effort, not part of the trust-improvement v1 the spec was scoped
around.

## Goal

Render a freshness badge on Quote and News surfaces in the web app. A badge
shows one of `Fresh | Stale | Expired | Unknown` per per-surface thresholds
defined in a single config module. The badge is read-only, accessibility-clean,
and emits at most one structured log event per render. Phase 2 (Citation,
Holdings) is queued behind named backend gaps.

## Scope

In:

- `apps/web/src/lib/freshness/freshness-config.ts` — single source of truth for
  per-surface thresholds (`freshWindowMs`, `staleWindowMs`).
- `apps/web/src/lib/freshness/freshness-state.ts` — pure function
  `computeFreshnessState({ sourceTimestampMs, nowMs, surface })` returning
  `{ state, ageMs, label, colorClass, surface }`.
- `apps/web/src/components/freshness/FreshnessBadge.tsx` — renders the state
  computed above. Tooltip + `aria-label` + keyboard focus.
- One thin React hook `useFreshnessNow()` that returns a `Date.now()` value
  that ticks while the tab is visible (uses `document.visibilityState` and a
  60s interval; freezes when hidden).
- Integration on Quote and News surfaces — exact files to modify identified
  by the existing component map (see "Implementation steps" below).
- One structured log event per render (`{ surface, state, ageMs }`); fire
  through the existing `apps/web/src/lib/observability/` logger if one
  exists, otherwise a thin `console.info` wrapper that is mockable in tests.
- Tests covering: state transitions on threshold edges; missing/null timestamp
  → `Unknown`; tab-visibility tick freeze.

Out:

- Citation and Holdings surfaces (phase 2 — backend timestamps missing).
- User-tunable thresholds.
- Click-to-refresh (spec says no in v1).
- Localization beyond `// TODO i18n` markers.
- SSE/WebSocket push.
- Any backend change.

## Assumptions

- The Quote surface in the UI today renders `MarketQuote` rows from the
  market-data API; subagent will locate the exact display callsite via
  `rg -n "marketQuoteSchema|MarketQuote\b" apps/web/src`. The `timestamp`
  field is epoch in the same unit the API emits it — verify
  whether seconds or milliseconds at one provider call site
  (`apps/api/src/market/providers/yahoo.provider.ts` is a good reference)
  before writing the adapter.
- The News surface in the UI uses `NewsItemResponse.publishedAt`. Subagent
  locates the rendering callsite via `rg -n "newsItemResponseSchema|publishedAt" apps/web/src`.
- The web app already uses Tailwind utility classes for color/spacing.
- `apps/web` does not declare `zod` directly — schemas come from
  `@finsentinel/shared`; this plan does not need zod.
- React 19, Next.js App Router; the badge is a pure client component.

## Key decisions

1. **Two surfaces only in v1.** Quote + News. Defer Citation/Holdings until the
   backend exposes a per-row source timestamp. This is a scope decision driven
   by the audit, not a missing feature in the badge.
2. **Epoch unit detection.** The badge consumes a normalized `sourceTimestampMs`
   (number, milliseconds since epoch). The Quote adapter is responsible for
   coercing whatever `marketQuoteSchema.timestamp` actually contains. The
   adapter is centralized in one helper so the unit decision is in one place.
3. **No backend change.** Phase 2 will need a backend prerequisite plan; phase 1
   does not touch any controller or service.
4. **Logger lookup before invention.** If `apps/web/src/lib/observability/`
   exists, use it. If not, the badge writes a thin local logger module that
   future observability rollout can replace; do not introduce a new logging
   library.
5. **Storybook is not required.** Component tests via React Testing Library
   cover all four states; no Storybook addition in this plan.

## File structure

```
apps/web/src/
  lib/freshness/
    freshness-config.ts                 (new)
    freshness-state.ts                  (new)
    freshness-state.test.ts             (new)
    use-freshness-now.ts                (new)
    use-freshness-now.test.tsx          (new)
  components/freshness/
    FreshnessBadge.tsx                  (new)
    FreshnessBadge.test.tsx             (new)
  views/                                (modify two existing surfaces)
    <quote rendering callsite>.tsx
    <news rendering callsite>.tsx

docs/exec-plans/
  tech-debt-tracker.md                  (modify — add phase-2 prerequisite entry)
```

## Implementation steps

### Step 0 — Locate the rendering callsites (no code change)

Verify with:

```bash
rg -n "marketQuoteSchema|MarketQuote\b|getQuote" apps/web/src
rg -n "publishedAt|NewsItemResponse" apps/web/src
```

Pick exactly one Quote callsite and one News callsite for v1. Record the file
paths in the progress log before starting Step 1. If either surface does not
render the timestamp-bearing object directly (e.g. the page maps to a
different display DTO that drops the timestamp), STOP and surface the gap —
adding a timestamp into a display DTO is a small but real schema change that
needs an explicit decision before continuing.

### Step 1 — `freshness-config.ts`

Per-surface thresholds:

```ts
export type FreshnessSurface = 'quote' | 'news' | 'citation' | 'holdings';

export interface FreshnessThresholds {
  freshWindowMs: number;
  staleWindowMs: number;
}

export const FRESHNESS_THRESHOLDS: Record<FreshnessSurface, FreshnessThresholds> = {
  quote:    { freshWindowMs:        60_000, staleWindowMs:    5 * 60_000 },
  news:     { freshWindowMs:   15 * 60_000, staleWindowMs:    6 * 60 * 60_000 },
  citation: { freshWindowMs:   24 * 60 * 60_000, staleWindowMs: 7 * 24 * 60 * 60_000 },
  holdings: { freshWindowMs:    5 * 60_000, staleWindowMs:   30 * 60_000 },
};
```

`citation` and `holdings` keys ship now even though the surfaces are out of v1
scope, so phase 2 can adopt them without touching this file.

Verify: a unit test asserts the four keys exist and each interval is positive
and `staleWindowMs > freshWindowMs`.

### Step 2 — `freshness-state.ts` (pure)

Function signature:

```ts
export type FreshnessState = 'fresh' | 'stale' | 'expired' | 'unknown';

export interface FreshnessResult {
  state: FreshnessState;
  ageMs: number | null;
  label: string;
  colorClass: string;
  surface: FreshnessSurface;
}

export function computeFreshnessState(args: {
  sourceTimestampMs: number | null | undefined;
  nowMs: number;
  surface: FreshnessSurface;
}): FreshnessResult;
```

Behavior:

- `sourceTimestampMs == null` or NaN → `unknown`, `ageMs = null`.
- `ageMs <= freshWindowMs` → `fresh`, label `"Live"` for `quote`, `"Fresh"` for
  others (single string switch keeps copy in one place).
- `freshWindowMs < ageMs <= staleWindowMs` → `stale`, label
  `"<X> min old"` (round down, minimum 1 min).
- `ageMs > staleWindowMs` → `expired`, label `"Old (<human>)"` where human is
  `5h`, `2d`, etc. — single helper `humanizeAge(ms)`.
- `colorClass` mapping:
  - `fresh`    → `bg-green-100 text-green-800`
  - `stale`    → `bg-amber-100 text-amber-800`
  - `expired`  → `bg-red-100 text-red-800`
  - `unknown`  → `bg-gray-100 text-gray-700`

Tests (table-driven):
- Each state at the threshold boundary (`freshWindowMs`, `freshWindowMs + 1ms`,
  `staleWindowMs`, `staleWindowMs + 1ms`).
- `null` timestamp → unknown.
- Negative `ageMs` (clock skew, source from the future) → treat as `fresh`
  with `ageMs = 0`.

### Step 3 — `useFreshnessNow()` hook

A single React hook that returns `now: number` (`Date.now()`) and re-renders
once a minute while `document.visibilityState === 'visible'`. When the tab is
hidden, the timer is cleared. On `visibilitychange` to visible, the hook ticks
immediately so the badge does not freeze on stale "now" after a long hide.

Tests:
- Mount → returns initial `Date.now()`.
- Advance fake timers by 60s → `now` advances.
- Set `document.visibilityState = 'hidden'` and dispatch `visibilitychange` →
  timer no longer fires.
- Switch back to `visible` → tick fires immediately and resumes interval.

### Step 4 — `FreshnessBadge` component

Props:

```ts
interface FreshnessBadgeProps {
  surface: FreshnessSurface;
  sourceTimestampMs: number | null | undefined;
  className?: string;
}
```

Render: a focusable `<span role="status" tabIndex={0}>` with the label and
color class from `computeFreshnessState`. Tooltip via `title=` showing the
absolute timestamp (`new Date(sourceTimestampMs).toISOString()`) and the human
delta. `aria-label` mirrors the visible label. On render, fire one log
event `{ surface, state, ageMs }` via the resolved logger.

Tests:
- Renders the four states given matching `sourceTimestampMs` values relative
  to a fixed `nowMs` (use `vi.setSystemTime`).
- Renders `Unknown` when `sourceTimestampMs == null`.
- `aria-label` matches visible text.
- Logs exactly one structured event per render.
- Tab-key focus reaches the badge (`role="status"` + `tabIndex={0}`).

### Step 5 — Quote surface integration

In the located Quote callsite (Step 0):

- Adapter: convert `marketQuote.timestamp` to milliseconds. Determine seconds
  vs ms by reading `apps/api/src/market/providers/yahoo.provider.ts` at the
  point it constructs the `MarketQuote`. Code defensively: `ts < 1e12 ? ts * 1000 : ts`
  is a safe coercion if the providers are inconsistent — but FIRST verify
  empirically by reading the providers. Document the finding in the
  progress log.
- Render `<FreshnessBadge surface="quote" sourceTimestampMs={tsMs} />` next
  to the price (or in the column header for table layouts — the badge does
  not change the price's value or formatting).
- Snapshot/render test: badge appears beside price; with a mocked
  `nowMs - timestamp = 30s` it shows `Live`/`Fresh`; with `4 min` it shows
  `4 min old`.

### Step 6 — News surface integration

In the located News callsite (Step 0):

- `sourceTimestampMs = Date.parse(item.publishedAt)`.
- Render the badge inside the news card, near the headline metadata row.
- Tests mirror Step 5 with news thresholds.

### Step 7 — Tech-debt tracker update

Append to `docs/exec-plans/tech-debt-tracker.md`:

- A new section "PL-7 Freshness Badge phase 1 landed".
- A new section "PL-7 phase 2 prerequisites — Citation and Holdings need
  source timestamps":
  - Citation: `packages/shared/src/schemas/analysis.ts:83` `citationSchema`
    has no timestamp. Adding requires:
    1. Decide which timestamp matters — chunk capture time, source document
       publish date, or RAG retrieval time. (Source publish date is the
       product-correct answer for trust UI; chunk capture is what the system
       can produce cheaply.)
    2. Wire the chosen field through retrieval and into the citation contract.
    3. Then add `surface: "citation"` to the badge.
  - Holdings: `packages/shared/src/schemas/portfolio.ts:37` lacks a snapshot
    timestamp. Adding requires either `portfolioResponseSchema.snapshot.asOf`
    (one timestamp for the whole table) or `holdingResponseSchema.priceAt`
    (per-row); pick one product-side, then expose it.

### Step 8 — Verification

- `pnpm --filter @finsentinel/web typecheck` — PASS.
- `pnpm --filter @finsentinel/web test` — PASS, ≥ 12 new tests landed.
- `pnpm --filter @finsentinel/web lint -- src/lib/freshness src/components/freshness` — PASS for touched files.
- Manual smoke: load the Quote-rendering and News-rendering pages, observe
  badges. Document the surface paths in the PR description.

### Step 9 — Push + PR

```bash
git push -u origin feat/2026-04-25-pl7-freshness-badge-phase1
gh pr create --title "feat(web): PL-7 freshness badge phase 1 — Quote + News" \
  --body "Implements docs/exec-plans/2026-04-25-pl7-freshness-badge.md. Phase 1 covers Quote and News only; Citation and Holdings deferred to phase 2 pending backend timestamp exposure (see tech-debt tracker)."
```

## Verification approach

Each new module has a unit-test file. The feature has no backend code, so
verification is local to `apps/web` and entirely deterministic with
`vi.setSystemTime`. The only non-deterministic surface is `useFreshnessNow`
under fake timers, which the tests pin explicitly.

Manual smoke replaces a CI-level integration test because no test environment
in this repo currently renders the full Quote or News page against a live
NestJS API. That gap is documented in the tech-debt tracker; closing it is
out of scope here.

## Risks and blockers

- **Quote `timestamp` unit ambiguity.** If providers disagree (Yahoo seconds,
  Polygon ms), the adapter must normalize. Defensive coercion is acceptable
  for v1 only because the badge does not display the timestamp value
  directly — it displays a relative age.
- **Logger absence.** If no observability module exists, the local logger
  shim is intentionally trivial; do not invent metrics infrastructure here.
- **Tab-visibility correctness.** Tests must pin `visibilitychange`. Without
  that pin a long-hidden tab can show "Live" forever.
- **Citation / Holdings expectation drift.** The product spec lists four
  surfaces; this plan ships two. Anyone reading only the spec may expect
  four. The PR description must call out the audit + scope decision so the
  next reader does not infer regression.

## Progress log

- 2026-04-25: Plan drafted. Audit of source timestamps complete; spec scope
  trimmed to Quote + News for v1. Citation and Holdings queued under named
  backend prerequisites.

## Final outcome

(Filled after merge.)
