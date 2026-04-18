# Context Journal API

## Background

Task 1 added shared context journal schemas, the Drizzle table, and migration. Task 2 adds API/service behavior on top without implementing runtime streams, runtime control, final report materialization, or a ledger.

## Goal

Add a minimal `ContextJournalService`, wire chat compaction writes into it, allow `ContextFabricService` to consume journal context when a run id is available, and expose read APIs on `AnalysisRunController`.

## Scope

- Create `apps/api/src/analysis/context-journal.service.ts`.
- Register/export the service from `AnalysisModule`.
- Add optional journal injection to chat compaction and context fabric.
- Add context and stage input read methods to `AnalysisRunController`.
- Add/update the targeted API tests only.

## Assumptions

- Existing shared context layers stay limited to `summary`, `sourceIds`, and optional `updatedAt`.
- Journal context consumption should be optional and only selected when `assemble` receives a `runId`.
- Stage input write helpers are part of the service API, but Task 2 does not require wiring all stage executors to write snapshots.
- Ownership checks should remain in the controller via `AnalysisRunService.getForUser`.

## Implementation Steps

1. Add/adjust failing tests for service writes/reads, controller endpoints, compaction writes, and fabric journal consumption.
   Verify: targeted API test command fails because the service/endpoints are missing.
2. Implement `ContextJournalService` with append helpers and read/materialization methods.
   Verify: service spec passes.
3. Register the journal service and wire optional chat/fabric dependencies.
   Verify: compaction and fabric specs pass.
4. Add controller read endpoints with existing ownership checks.
   Verify: controller spec passes.
5. Run targeted tests and API typecheck.
   Verify: both commands pass.
6. Commit the scoped changes.
   Verify: `git status` contains only intentional changes before commit and is clean after commit.

## Verification Approach

- `pnpm --filter @finsentinel/api test -- src/analysis/__tests__/context-journal.service.spec.ts src/analysis/__tests__/analysis-run.controller.spec.ts src/chat/__tests__/chat-compaction.service.spec.ts src/analysis/__tests__/context-fabric.service.spec.ts`
- `pnpm --filter @finsentinel/api typecheck`

## Progress Log

- 2026-04-18: Created plan and inspected existing analysis/chat services and tests.
- 2026-04-18: Implemented `ContextJournalService`, wired it into `AnalysisModule`, added optional chat compaction writes, added journal-backed analysis context assembly, and exposed run context / stage input read endpoints on `AnalysisRunController`.
- 2026-04-18: Hardened journal writes with explicit UUID inserts, made stage-input lineage authoritative in `getRunContext`, added journal fallback behavior in `ContextFabricService`, and validated stage keys / snapshot reads on the run controller.
- 2026-04-18: Updated the four analysis team services to pass `runId` into `ContextFabricService.assemble(...)` so journal-backed run context is reachable from the real runtime path, and added coverage for the team call shape plus source-id filtering in `ContextJournalService`.
- 2026-04-18: Verified the Task 2 Vitest slice with `pnpm --filter @finsentinel/api exec vitest run src/analysis/__tests__/context-journal.service.spec.ts src/analysis/__tests__/analysis-run.controller.spec.ts src/chat/__tests__/chat-compaction.service.spec.ts src/analysis/__tests__/context-fabric.service.spec.ts` and `pnpm --filter @finsentinel/api typecheck`.
- 2026-04-18: Clarified the journal merge rule for ContextFabricService: adapter context stays the baseline, and journal layers override only when their own layer is useful.
- 2026-04-18: Fixed the remaining Task 2 code-quality issues by merging journal layers over adapter context instead of replacing the whole fabric result, and by constraining journal layer `updatedAt` to contributing rows only.

## Key Decisions

- Keep journal context materialization simple: map journal rows into existing `SharedContext` layers by entry type and source ids.
- Preserve the adapter-based context fabric path unless a `runId` is present and the journal loader is available.
- When journal context is useful, merge it layer-by-layer over adapter context instead of replacing the whole shared context.
- Keep chat compaction journal writes optional so isolated unit tests and partial module construction continue to work.
- Compaction rows are only discoverable through run-context assembly when stage snapshots keep their entry IDs. Task 3+ must preserve those references; otherwise journal-backed run context intentionally stays narrow instead of falling back to unrelated rows.

## Risks And Blockers

- Drizzle mocks in existing isolated tests may need small chain-method additions to match new query paths.
- Typecheck may expose stricter mocked-controller constructor requirements after adding `ContextJournalService`.
- If future stage writers omit `contextEntryIds` or `evidenceEntryIds`, journal-backed run context will stay empty by design rather than rehydrating unrelated compaction/RAG rows.

## Final Outcome

Implemented and verified in the openalice runtime foundation worktree. The API now writes compaction events and summaries to the context journal with explicit UUIDs, materializes run context from journal data when a run id is present only when that context is useful, merges useful journal layers over adapter context instead of replacing it wholesale, keeps journal layer timestamps aligned to contributing rows, falls back to adapters when journal data is empty, and exposes validated read endpoints for run context and stage input snapshots.
