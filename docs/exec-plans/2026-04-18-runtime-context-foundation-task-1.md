# Runtime & Context Foundation Task 1

## Background
This workstream is adding the shared contracts and database schema that future runtime/context features will build on. Task 1 is limited to shared schemas for context journal entries and runtime timeline events, plus the DB table for context journal entries.

## Goal
Add versioned, test-covered contracts for context journal entries and runtime timeline events, plus the matching context journal DB schema and exports.

## Scope
- Create shared Zod schemas for context journal entries and runtime timeline events.
- Export the new schemas from the shared schema index.
- Add a DB table for `context_journal_entries`.
- Export the new table and wire up relations.
- Add the canonical production migration under `packages/db/migrations/`.

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
4. Add the production migration for the new table.
   Verify: `packages/db/migrations/V14__add_context_journal_entries.sql` creates the table and indexes with `IF NOT EXISTS`.

## Verification approach
- `pnpm --filter @finsentinel/shared test -- src/__tests__/context-journal-schema.test.ts`
- `pnpm --filter @finsentinel/db typecheck`
- `pnpm --filter @finsentinel/shared build` if the DB typecheck needs fresh shared output
- `git diff --name-only 39ec323..HEAD` should not include `packages/db/drizzle/` paths

## Progress log
- 2026-04-18: Plan created.
- 2026-04-18: Reopened the partial implementation to remove the duplicate test wrapper and resolve the shared export collision before verification.
- 2026-04-18: Added the shared context journal contracts, DB table, exports, relations, and generated the Task 1 migration.
- 2026-04-18: Verified `pnpm --filter @finsentinel/shared test -- src/__tests__/context-journal-schema.test.ts`, `pnpm --filter @finsentinel/shared build`, `pnpm --filter @finsentinel/db typecheck`, and `pnpm --filter @finsentinel/db db:generate`.
- 2026-04-18: Updated the context journal schema with DB-aligned length validation, restored the single shared test glob, and added the canonical production V14 migration.
- 2026-04-18: Removed the generated Drizzle migration artifacts from the branch and split DB-length negative coverage into separate field-level assertions.

## Key decisions
- Keep the implementation minimal and schema-only.
- Model payloads as generic JSON records for now.
- Use a dedicated context journal table rather than overloading existing event tables.
- Keep the requested top-level shared test file as the runnable test and remove the nested duplicate.
- Keep `runtimeTimelineEventSchema` defined in `context-journal.ts` and do not re-export it from `event.ts`, so `schemas/index.ts` does not hit a duplicate export collision.
- Use `packages/db/migrations/V14__add_context_journal_entries.sql` as the production migration.
- `packages/db/drizzle/` is stale and unused for deploy migrations in this repo, so no Drizzle-generated migration artifacts belong in Task 1 output.

## Risks and blockers
- DB typecheck may need a shared rebuild if package outputs are stale in the worktree.
- Migration generation may surface unrelated schema drift; if so, inspect before changing scope.

## Final outcome
Implemented and verified in the isolated worktree. The Task 1 shared contracts, DB schema, and canonical production V14 migration are in place; Drizzle-generated migration artifacts were removed from the branch.
