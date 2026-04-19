# Operator Console Timeline UI

## Background

PR #11 added runtime control, run timeline streaming, stage retry, and materialized analysis outputs on the backend. The current web analysis workspace still presents the run as a polled progress panel and does not expose the timeline stream, retry action, or persisted decision object as primary operator console UI.

## Goal

Connect the web analysis workspace to the #11 runtime surface so an operator can watch run events live, retry failed stages, and inspect the materialized final report and decision object from the run record.

## Scope

- Add frontend API coverage for run timeline SSE and stage retry.
- Extend the analysis run hook to subscribe to the run stream and expose timeline state.
- Add an Operator Timeline panel to the analysis workspace.
- Wire retry controls into the existing stage progress panel.
- Render materialized `decisionObjectJson` from the run instead of deriving a decision object from risk artifacts.

## Assumptions

- The existing Next.js API proxy keeps `/api/analysis/runs/:id/stream` reachable from the browser.
- The authenticated fetch path with `authHeaders()` is sufficient for the SSE request because EventSource cannot attach authorization headers.
- Polling can remain as a fallback/refresh mechanism while the stream supplies timeline events.
- Backend run rows currently expose raw Drizzle JSON fields named `sharedContextJson` and `decisionObjectJson`.

## Implementation Steps

1. Add typed frontend API methods for `retryStage` and `stream`.
   Verify: unit tests assert endpoint paths, methods, credentials, and SSE event parsing.
2. Extend `useAnalysisRun` with stream subscription, timeline event accumulation, stream status, and retry helper.
   Verify: TypeScript typecheck validates hook consumers and cleanup shape.
3. Add an Operator Timeline panel and wire it into `AnalysisPage`.
   Verify: component builds and renders from hook-provided timeline events without requiring backend changes.
4. Update progress and final report panels for retry and materialized decision object.
   Verify: targeted web API tests, web typecheck, and diff whitespace checks pass.

## Verification Approach

- `pnpm --filter @finsentinel/web test -- src/api/__tests__/analysis-runs.test.ts`
- `pnpm --filter @finsentinel/web typecheck`
- `git diff --check`

## Progress Log

- 2026-04-18: Switched to `main`, fast-forwarded through #11, and created `codex/operator-console-timeline-ui`.
- 2026-04-18: Confirmed backend stream, retry, and materialized-output contracts from source.
- 2026-04-18: Created this execution plan before editing frontend code.
- 2026-04-18: Added frontend stream/retry API coverage, timeline hook state, Operator Timeline UI, retry controls, and materialized report/context rendering.
- 2026-04-18: Verified targeted API tests, web typecheck, touched-file lint, and `git diff --check`.

## Key Decisions

- Use `fetch` + `ReadableStream` SSE parsing instead of `EventSource` so the request can carry existing auth headers.
- Keep existing polling as a fallback and state refresh path; the new stream is the timeline source of truth for operator events.
- Treat `decisionObjectJson` on the run as the materialized decision object for the UI.
- Do not fix unrelated full-lint failures in this PR; they are outside the Operator Console scope.

## Risks And Blockers

- If the API proxy buffers SSE, the UI will fall back to polling but the timeline will not update live.
- If authentication is not primed before the stream opens, the first stream connection can fail until the user refreshes or another authenticated API call succeeds.
- Full web lint currently fails on pre-existing files outside this change: `AuthContext.tsx`, `hybrid-search.test.ts`, and `is-tauri.test.ts`.

## Final Outcome

Implemented. Verification passed for:

- `pnpm --filter @finsentinel/web test -- src/api/__tests__/analysis-runs.test.ts`
- `pnpm --filter @finsentinel/web typecheck`
- `pnpm --filter @finsentinel/web exec eslint src/api/analysis-runs.ts src/api/__tests__/analysis-runs.test.ts src/hooks/useAnalysisRun.ts src/components/analysis/TimelinePanel.tsx src/components/analysis/LiveProgressPanel.tsx src/components/analysis/FinalReportPanel.tsx src/components/analysis/RunSetupPanel.tsx src/views/AnalysisPage.tsx`
- `git diff --check`

Full `pnpm --filter @finsentinel/web lint` was attempted and failed only on pre-existing unrelated files listed under risks.
