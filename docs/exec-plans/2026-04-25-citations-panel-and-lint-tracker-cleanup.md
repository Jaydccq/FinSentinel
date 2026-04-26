# Citations Panel + Lint Tracker Cleanup — Execution Plan

Date: 2026-04-25
Status: Draft — ready for execution
Owner: hongxichen + Claude

## Background

Two small, independent items:

1. **Web lint pre-existing violations.** `docs/exec-plans/tech-debt-tracker.md`
   has an "Open" entry observed 2026-04-18 listing three lint violations:
   - `apps/web/src/context/AuthContext.tsx` — `react-hooks/set-state-in-effect`
   - `apps/web/src/lib/rag/__tests__/hybrid-search.test.ts` — unused `HybridHit` import
   - `apps/web/src/lib/tauri/__tests__/is-tauri.test.ts` — explicit `any`

   **Audit (2026-04-25):** `pnpm --filter @finsentinel/web lint` exits 0 with
   no output. The `HybridHit` import is actively used by `assertHybridHitShape`.
   The other two files were quietly fixed somewhere along the way without
   updating the tracker. The entry is stale.

2. **PL-7 Citation badge — UI rendering surface.** Phase 2 frontend deferred
   the Citation badge because the analysis UI did not surface individual
   citations. `AnalysisPage.tsx` mounts `RunSetupPanel`, `LiveProgressPanel`,
   `TimelinePanel`, `ContextPanel`, `ArtifactsPanel`, `FinalReportPanel`,
   `HumanApprovalRail`, `RunNavigator` — none lists citations. But the data
   is reachable: completed stages carry `structuredOutput.citations: Citation[]`
   per the shared `stageStructuredOutputSchema`, and the typed web hook
   returns those stages already.

This plan ships a `CitationsPanel` component that lists per-stage citations
with a freshness badge per row.

## Goal

- Mark the stale lint-violation tech-debt entry as closed and pin the audit
  evidence (lint exit 0, file content shows no violations).
- Render a `CitationsPanel` on the analysis page that lists each completed
  stage's citations. Each row shows title / source / excerpt and a
  `<FreshnessBadge surface="citation" sourceTimestampMs={…} />` driven by
  `citation.publishedAt`. Citations missing `publishedAt` render an
  `Unknown` badge (not nothing) so users can tell apart "fresh" from "we
  don't know how old this source is".

## Scope

In:

- `docs/exec-plans/tech-debt-tracker.md` — close the lint entry; record the
  audit evidence inline.
- `apps/web/src/components/analysis/CitationsPanel.tsx` — new component.
- `apps/web/src/components/analysis/CitationsPanel.test.tsx` — new tests.
- `apps/web/src/api/analysis-runs.ts` — tighten
  `AnalysisStageResponse.structuredOutput` to the shared `StageStructuredOutput`
  (or a narrower projection that includes `citations: Citation[]`) so the
  TypeScript type matches the wire shape.
- `apps/web/src/views/AnalysisPage.tsx` — mount `<CitationsPanel stages={…} />`
  between `ArtifactsPanel` and `FinalReportPanel`.
- `apps/web/src/views/__tests__/AnalysisPage.test.tsx` — render-test that
  passes a mocked stage with two citations (one with `publishedAt`, one
  without) and asserts both rows + badges render.
- Update tech-debt-tracker: close the "PL-7 Citation badge — blocked on web
  rendering surface" entry; reference the commit hash.

Out:

- Citation deduplication across stages (a citation may appear in multiple
  stages' `structuredOutput.citations`). Phase 1 ships per-stage lists; the
  user is unlikely to be confused by duplicates inside one analysis.
- "Cite this" copy / external link tracking.
- Stage-level filtering UI.
- Any backend change. The schema already accepts `publishedAt`; phase 2
  backend landed it.

## Key decisions

1. **Tighten `AnalysisStageResponse.structuredOutput` to the shared shape.** The
   current `[key: string]: unknown` open-record forces a runtime parse to
   reach `citations`. Tightening to `StageStructuredOutput | null` keeps
   typecheck honest and lets the panel read `stage.structuredOutput?.citations`
   without casts.
2. **Always render the badge.** When `citation.publishedAt` is missing we
   render `<FreshnessBadge sourceTimestampMs={null} />` so the badge shows
   `Unknown`. Hiding the badge would silently drop the trust signal.
3. **Per-stage grouping.** Citations are listed under a header per stage
   key (e.g. "Intelligence", "Risk"). This matches the existing analysis
   page mental model where stages are first-class.
4. **Empty-state copy.** When no stage has citations, render "No citations
   yet — citations appear once stages complete." in a small italic line.
   No extra panel chrome.
5. **No new SWR fetcher.** `useAnalysisRun(activeRunId)` already exposes
   `stages`. The panel is a pure consumer.

## File structure

```
apps/web/src/
  components/analysis/
    CitationsPanel.tsx                    (new)
    CitationsPanel.test.tsx               (new)
  api/
    analysis-runs.ts                      (modify — tighten structuredOutput type)
  views/
    AnalysisPage.tsx                      (modify — mount panel)
    __tests__/AnalysisPage.test.tsx       (extend — citation render case)

docs/exec-plans/
  tech-debt-tracker.md                    (modify — close 2 entries)
```

---

## Task 1 — Tracker close-out for stale lint entry

### 1.1 Audit and edit

Edit `docs/exec-plans/tech-debt-tracker.md`. The current entry titled
something like "`apps/web` full lint is blocked by pre-existing violations"
becomes:

```markdown
### `apps/web` full lint — RESOLVED 2026-04-25

- **Originally observed:** 2026-04-18 while verifying Operator Console Timeline UI.
- **Cited violations:**
  - `apps/web/src/context/AuthContext.tsx` `react-hooks/set-state-in-effect`
  - `apps/web/src/lib/rag/__tests__/hybrid-search.test.ts` unused `HybridHit`
  - `apps/web/src/lib/tauri/__tests__/is-tauri.test.ts` explicit `any`
- **Audit 2026-04-25:** `pnpm --filter @finsentinel/web lint` exits 0 with
  zero output. `HybridHit` is actively consumed by `assertHybridHitShape` in
  the rag hybrid-search test. The other two violations were quietly fixed
  by intermediate PRs without updating this entry. No code change needed.
- **Status:** Closed.
```

### 1.2 Commit

```bash
git commit -m "docs(tech-debt): close stale apps/web lint entry — audit shows lint passes"
```

---

## Task 2 — Tighten `AnalysisStageResponse.structuredOutput`

### 2.1 Type update

`apps/web/src/api/analysis-runs.ts:104`:

Before:
```ts
structuredOutput?: { roleSummaries?: RoleSummary[]; [key: string]: unknown };
```

After (preferred — full shape):
```ts
structuredOutput?: StageStructuredOutput;
```

…with `StageStructuredOutput` imported from `@finsentinel/shared` (it's
already exported from `packages/shared/src/schemas/analysis.ts`). The shape
includes `citations: Citation[]` plus other fields the rest of the page
already consumes via the open-record fallback. If `roleSummaries` was
optional in the old shape but required in shared, narrow with a Pick<> or
keep the existing open-record but add `citations?: Citation[]` only — pick
whichever is cleaner after reading the actual shared export.

### 2.2 Verify nothing breaks

- `pnpm --filter @finsentinel/web typecheck` — PASS.
- Run the existing analysis page tests — PASS.

### 2.3 Commit

```bash
git commit -m "refactor(web): tighten AnalysisStageResponse.structuredOutput to shared shape"
```

---

## Task 3 — `CitationsPanel` component

### 3.1 Tests first

`apps/web/src/components/analysis/CitationsPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CitationsPanel } from './CitationsPanel';
import type { AnalysisStageResponse } from '../../api/analysis-runs';

describe('CitationsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  const stage = (overrides: Partial<AnalysisStageResponse>): AnalysisStageResponse => ({
    id: 's1',
    runId: 'r1',
    stageKey: 'INTELLIGENCE' as never,
    status: 'COMPLETED',
    checkpointVersion: 1,
    humanReportMarkdown: null,
    startedAt: null,
    completedAt: '2026-04-25T11:55:00.000Z',
    structuredOutput: {
      summary: '',
      thesis: '',
      risks: [],
      openQuestions: [],
      citations: [],
      confidence: 0.5,
    },
    ...overrides,
  });

  it('renders empty-state when no stage has citations', () => {
    render(<CitationsPanel stages={[]} />);
    expect(screen.getByText(/No citations yet/i)).toBeInTheDocument();
  });

  it('renders one row per citation grouped by stage', () => {
    render(
      <CitationsPanel
        stages={[
          stage({
            structuredOutput: {
              summary: '',
              thesis: '',
              risks: [],
              openQuestions: [],
              citations: [
                { title: 'AAPL 10-K', url: 'https://x', publishedAt: '2026-04-25T11:00:00.000Z' },
                { title: 'Reuters', url: 'https://y' },
              ],
              confidence: 1,
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText('AAPL 10-K')).toBeInTheDocument();
    expect(screen.getByText('Reuters')).toBeInTheDocument();
  });

  it('renders Fresh badge for citation with publishedAt within fresh window', () => {
    render(
      <CitationsPanel
        stages={[
          stage({
            structuredOutput: {
              summary: '',
              thesis: '',
              risks: [],
              openQuestions: [],
              citations: [{ title: 'A', publishedAt: '2026-04-25T11:00:00.000Z' }],
              confidence: 1,
            },
          }),
        ]}
      />,
    );
    const badges = screen.getAllByRole('status');
    const fresh = badges.find((b) => b.getAttribute('data-status') === 'fresh');
    expect(fresh).toBeTruthy();
  });

  it('renders Unknown badge for citation without publishedAt', () => {
    render(
      <CitationsPanel
        stages={[
          stage({
            structuredOutput: {
              summary: '',
              thesis: '',
              risks: [],
              openQuestions: [],
              citations: [{ title: 'A' }],
              confidence: 1,
            },
          }),
        ]}
      />,
    );
    const badges = screen.getAllByRole('status');
    const unknown = badges.find((b) => b.getAttribute('data-status') === 'unknown');
    expect(unknown).toBeTruthy();
  });
});
```

### 3.2 Component

`apps/web/src/components/analysis/CitationsPanel.tsx`:

```tsx
'use client';

import type { AnalysisStageResponse } from '../../api/analysis-runs';
import type { Citation } from '@finsentinel/shared';
import { FreshnessBadge } from '../freshness/FreshnessBadge';

interface CitationsPanelProps {
  stages: AnalysisStageResponse[];
}

export function CitationsPanel({ stages }: CitationsPanelProps) {
  const stagesWithCitations = stages
    .map((s) => ({
      stageKey: s.stageKey,
      stageId: s.id,
      citations: (s.structuredOutput?.citations ?? []) as Citation[],
    }))
    .filter((g) => g.citations.length > 0);

  if (stagesWithCitations.length === 0) {
    return (
      <section
        aria-labelledby="citations-panel-heading"
        className="rounded border border-gray-200 p-4"
      >
        <h2 id="citations-panel-heading" className="text-sm font-semibold mb-2">
          Citations
        </h2>
        <p className="text-xs italic text-gray-500">
          No citations yet — citations appear once stages complete.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="citations-panel-heading"
      className="rounded border border-gray-200 p-4 space-y-3"
    >
      <h2 id="citations-panel-heading" className="text-sm font-semibold">
        Citations
      </h2>
      {stagesWithCitations.map((g) => (
        <div key={g.stageId} className="space-y-2">
          <h3 className="text-xs font-medium uppercase text-gray-500">{g.stageKey}</h3>
          <ul className="space-y-2">
            {g.citations.map((c, i) => (
              <li
                key={`${g.stageId}-${i}`}
                className="flex items-start gap-2 rounded bg-gray-50 px-3 py-2"
              >
                <FreshnessBadge
                  surface="citation"
                  sourceTimestampMs={c.publishedAt ? Date.parse(c.publishedAt) : null}
                />
                <div className="flex-1 text-sm">
                  <div className="font-medium">{c.title ?? c.url ?? c.artifactId ?? 'Untitled'}</div>
                  {c.url ? (
                    <a
                      className="text-xs text-blue-700 hover:underline"
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {c.url}
                    </a>
                  ) : null}
                  {c.excerpt ? <div className="mt-1 text-xs text-gray-700">{c.excerpt}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
```

### 3.3 Verify

- `pnpm --filter @finsentinel/web typecheck` — PASS.
- `pnpm --filter @finsentinel/web test -- src/components/analysis/CitationsPanel.test.tsx` — PASS.

### 3.4 Commit

```bash
git commit -m "feat(web): add CitationsPanel listing per-stage citations with freshness badge"
```

---

## Task 4 — Mount the panel in AnalysisPage

### 4.1 Test

Add a render-test in `apps/web/src/views/__tests__/AnalysisPage.test.tsx`
(create if missing) that mocks `useAnalysisRun` to return one completed stage
with two citations (one timestamped, one not). Assert both rows are rendered
under a "Citations" heading.

### 4.2 Edit AnalysisPage

`apps/web/src/views/AnalysisPage.tsx`: import `CitationsPanel`, mount it
between `ArtifactsPanel` and `FinalReportPanel`:

```tsx
<ArtifactsPanel artifacts={artifacts} />
<CitationsPanel stages={stages} />
<FinalReportPanel run={run} artifacts={artifacts} />
```

### 4.3 Commit

```bash
git commit -m "feat(web): mount CitationsPanel on AnalysisPage between artifacts and final report"
```

---

## Task 5 — Tracker close-out for Citation badge

Update `docs/exec-plans/tech-debt-tracker.md`:

- The "PL-7 Citation badge — blocked on web rendering surface" entry (added
  alongside phase 2 frontend) gets marked CLOSED with the commit hashes from
  Task 3 / 4. Note the surface decisions:
  - Per-stage grouping.
  - Always-render badge (Unknown when no `publishedAt`).
  - No de-duplication across stages in v1.

```bash
git commit -m "docs(tech-debt): close PL-7 Citation badge entry — CitationsPanel landed"
```

---

## Verification

- `pnpm --filter @finsentinel/shared build` — PASS.
- `pnpm --filter @finsentinel/web typecheck` — PASS.
- `pnpm --filter @finsentinel/web test --run` — PASS (new component tests + new
  page test land cleanly).
- `pnpm --filter @finsentinel/web lint` — PASS (must stay 0 — guards against
  re-introducing the kind of debt this plan just closed).

## Risks

- **`StageStructuredOutput` shape mismatch with the wire.** If the API today
  emits a stricter or looser shape than the schema declares (the wire is
  validated against the shared schema before it leaves NestJS, so this should
  hold — but verify by reading one stage's actual JSON in dev). If it doesn't
  match, fall back to leaving `[key: string]: unknown` and *adding*
  `citations?: Citation[]` instead.
- **Per-stage duplicates.** If `Intelligence` and `Thesis` both cite the
  same URL, the user sees both rows. Acceptable for v1; phase 2 may dedupe.
- **`publishedAt` accuracy.** The schema accepts whatever the LLM emits.
  Garbage-in / garbage-out — the badge can render "Old (3y)" if the LLM
  hallucinates an old timestamp. Acceptable signal: it tells the user the
  citation is questionable.

## Progress log

- 2026-04-25: Plan drafted. Audit confirms `apps/web` lint passes today —
  the tracker entry is stale, not load-bearing. CitationsPanel scope kept
  small — pure consumer of existing `useAnalysisRun.stages`.

## Final outcome

(Filled after merge.)
