# Runtime & Context Foundation Task 1

## Background
This workstream is adding the shared contracts and database schema that future runtime/context features will build on. Task 1 is limited to shared schemas and DB tables for context journal entries and runtime timeline events.

## Goal
Add versioned, test-covered contracts for context journal entries and runtime timeline events, plus the matching Drizzle schema and exports.

## Scope
- Create shared Zod schemas for context journal entries and runtime timeline events.
- Export the new schemas from the shared schema index.
- Add a DB table for `context_journal_entries`.
- Export the new table and wire up relations.
- Generate the corresponding migration.

## Assumptions
- The task intentionally stops at schema and contract work.
- Later runtime service/controller behavior will be added in separate tasks.
- Existing schema conventions in `packages/shared` and `packages/db` should be followed without broad refactors.

## Implementation steps
1. Add a failing shared-schema test for the new contracts.
   Verify: the test fails because the module exports are missing.
2. Implement the shared contracts and export them.
   Verify: the new test passes.
3. Add the DB table and exports/relations.
   Verify: `pnpm --filter @finsentinel/db typecheck` passes.
4. Generate the migration for the new table.
   Verify: a new SQL migration appears under `packages/db/drizzle/`.

## Verification approach
- `pnpm --filter @finsentinel/shared test -- src/__tests__/context-journal-schema.test.ts`
- `pnpm --filter @finsentinel/db typecheck`
- `pnpm --filter @finsentinel/shared build` if the DB typecheck needs fresh shared output

## Progress log
- 2026-04-18: Plan created.
- 2026-04-18: Reopened the partial implementation to remove the duplicate test wrapper and resolve the shared export collision before verification.
- 2026-04-18: Added the shared context journal contracts, DB table, exports, relations, and generated the Task 1 migration.
- 2026-04-18: Verified `pnpm --filter @finsentinel/shared test -- src/__tests__/context-journal-schema.test.ts`, `pnpm --filter @finsentinel/shared build`, `pnpm --filter @finsentinel/db typecheck`, and `pnpm --filter @finsentinel/db db:generate`.

## Key decisions
- Keep the implementation minimal and schema-only.
- Model payloads as generic JSON records for now.
- Use a dedicated context journal table rather than overloading existing event tables.
- Keep the requested top-level shared test file as the runnable test and remove the nested duplicate.
- Keep `runtimeTimelineEventSchema` defined in `context-journal.ts` and do not re-export it from `event.ts`, so `schemas/index.ts` does not hit a duplicate export collision.

## Risks and blockers
- DB typecheck may need a shared rebuild if package outputs are stale in the worktree.
- Migration generation may surface unrelated schema drift; if so, inspect before changing scope.

## Final outcome
Implemented and verified in the isolated worktree. The Task 1 shared contracts, DB schema, and generated migration are in place.
