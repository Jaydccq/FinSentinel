# Product Spec: PL-7 Freshness Badge (v1)

Date: 2026-04-25
Status: Draft — ready for engineering estimation
Owners: hongxichen + Claude
Source: `docs/product-specs/2026-04-25-product-loop-roadmap-triage.md` PL-7

## 1. User story

> *As a research/portfolio user, I want to see at a glance whether the data on the screen is fresh, stale, or unknown, so that I do not act on outdated quotes, filings, or news.*

## 2. Why now

PL-7 is the smallest cross-cutting trust improvement on the product roadmap. It is the only item in the roadmap that materially de-risks every other product loop (audit log, citation reports, watchlist triggers, trade-from-research) because they all consume timestamped data sources.

## 3. In-scope behavior (v1)

### 3.1 Surfaces

V1 covers exactly four surfaces. Anything else stays as future work.

1. **Quote / market-data display.** Anywhere a price or quote is displayed on the Portfolio, Watchlist, or Market pages.
2. **News card.** Anywhere a news item is rendered on Market or News pages.
3. **Filings / RAG citation.** Document title rendered in research answers or report views.
4. **Portfolio holdings table.** The "as of" timestamp shown above the positions list.

### 3.2 States

A freshness badge is one of:

| State    | Trigger condition                       | Color | Copy                            | Tooltip example                         |
| -------- | --------------------------------------- | ----- | ------------------------------- | --------------------------------------- |
| Fresh    | `now - sourceTimestamp ≤ freshWindow`   | green | "Live" / "Fresh"                | "Updated 12s ago"                        |
| Stale    | `freshWindow < now - sourceTimestamp ≤ staleWindow` | amber | "X min old"           | "This source last updated 6 min ago"     |
| Expired  | `now - sourceTimestamp > staleWindow`   | red   | "Old (X)"                       | "Data may be inaccurate; refresh to retry" |
| Unknown  | source timestamp missing or unreadable  | gray  | "Unknown freshness"             | "We could not read the source timestamp" |

### 3.3 Per-surface thresholds (v1 defaults)

| Surface             | freshWindow | staleWindow |
| ------------------- | ----------- | ----------- |
| Quote / market data | 60 s        | 5 min       |
| News card           | 15 min      | 6 hr        |
| Filings / citation  | 24 hr       | 7 d         |
| Portfolio holdings  | 5 min       | 30 min      |

Thresholds live in a single config module (`apps/web/src/lib/freshness/freshness-config.ts`) so v2 can promote them to user settings without touching surfaces.

### 3.4 Behavior

- The badge **never blocks** the underlying content. If the data is expired, the user can still read it; the badge only signals risk.
- Tooltip on hover shows absolute timestamp (`2026-04-25 12:00 UTC`) plus the human delta.
- The badge is keyboard-accessible: focusable element, screen-reader text matches the visible copy.
- Clicking the badge does **not** trigger a refetch in v1 (avoids accidental burst on stale tabs). Future spec revision may add an explicit "Refresh" affordance.

### 3.5 Data contract

Each surface's data source must expose a timestamp field. V1 uses the following mapping:

| Surface     | Source field                                 | Owner module                          |
| ----------- | -------------------------------------------- | ------------------------------------- |
| Quote       | `quoteResponse.lastTradedAt`                 | `apps/api/src/market/`                |
| News        | `newsItem.publishedAt`                       | `apps/api/src/news/`                  |
| Citation    | `citation.documentMetadata.publishedAt`      | `apps/api/src/rag/`                   |
| Holdings    | `portfolioResponse.snapshot.asOf`            | `apps/api/src/portfolio/`             |

If a surface ships with `null`/missing timestamps, the badge renders **Unknown** rather than disappearing.

## 4. Out of scope (v1)

- Pushing freshness through SSE / WebSocket.
- Per-user preference for thresholds.
- Refetch-on-click.
- Surfaces other than the four listed.
- Backend instrumentation (a separate plan can add server-side freshness metrics).
- Localization (English-only in v1; mark all copy strings for future i18n).

## 5. Non-goals

- This feature does **not** prevent users from acting on stale data. It surfaces risk, not enforcement. Trade-from-research (PL-5) is where freshness becomes a hard gate; v1 deliberately stops short.

## 6. Acceptance criteria

1. **Visual:** Each of the four surfaces renders one of {Fresh, Stale, Expired, Unknown} per the threshold table.
2. **Stability:** A surface whose source timestamp is missing renders **Unknown**, not Fresh.
3. **Tooltip parity:** The tooltip's absolute timestamp matches the source field within 1 second.
4. **Accessibility:** Each badge is reachable by keyboard tab order, has an `aria-label` matching visible copy, color contrast ≥ AA.
5. **Tests:** Component tests cover all four state transitions for each surface; threshold edge cases (`freshWindow + 1s`, `staleWindow + 1s`) are explicitly tested.
6. **Telemetry:** Each badge render emits at most one structured log event per surface per page view (`{ surface, state, ageMs }`) — useful for v2 prioritization, never PII.
7. **Performance:** Adding the badge does not regress page Time-to-Interactive by more than 30 ms (sample on Portfolio page).

## 7. Safety / trust requirements

- No badge ever **omits** itself silently — if rendering fails, fall back to Unknown rather than no badge.
- The badge does not change the underlying displayed value or units.
- Color is never the sole signal — copy and tooltip carry the same information.

## 8. Verification plan

1. Component-level tests for each badge state and threshold edge.
2. Page-level test on Portfolio that proves the holdings table badge changes state when the mocked `asOf` advances past the stale window.
3. Manual QA checklist (recorded in the implementation plan): each surface visually verified at all four states using Storybook-style props.
4. Telemetry check: confirm a single freshness event per surface per page render via a unit test on the logger wrapper.

## 9. Engineering prerequisites

- Surfaces must already render the source timestamps; no new backend fields needed in v1 (verified against the four owner modules above).
- Config module must be a single source of truth — if a future change touches thresholds, it touches one file.

## 10. Recommended next step

Convert this product spec into an execution plan under `docs/superpowers/plans/` once the source-timestamp audit confirms all four surfaces actually carry the listed fields. The audit is small — read the four typed responses in `packages/shared/src/schemas/` and confirm each has a timestamp; if any is missing, add it to the spec gap list before writing the plan.

## 11. Open questions

| #  | Question                                                                         | Suggested default                                                              |
| -- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Q1 | Should the badge auto-refresh its delta text every minute, or only on focus?     | Auto-refresh while tab visible; freeze when hidden — matches SWR `revalidateOnFocus = false`. |
| Q2 | Where does the badge live for the Portfolio holdings table — header or per row? | Header only in v1. Per-row badge is too noisy until thresholds are user-tuned. |
| Q3 | Do citations need separate thresholds for SEC vs news-document sources?          | No — one citation threshold for v1; instrument and revisit.                    |

These are not blockers for engineering estimation. The defaults are good enough to start.
