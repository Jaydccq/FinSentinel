# F-4: Document upload outbox + presigned URL direct upload

Date: 2026-04-24
Status: Outbox slice landed 2026-04-24; presigned URL + reconciler deferred
Source: [docs/exec-plans/2026-04-24-deferred-followups.md §F-4](./2026-04-24-deferred-followups.md)

## What landed (outbox slice)

### DB shape
- New `DocumentStatus.PENDING_UPLOAD` enum entry in
  `packages/shared/src/enums/document-status.ts`. The `documents.status`
  column is a plain `varchar(50)` with no CHECK constraint — no
  migration needed.

### Service flow
`DocumentUploadService.upload` now follows the outbox order:

```
insert documents(status=PENDING_UPLOAD)      ← DB first
  ↓
storage.upload(key, buffer, mime)            ← storage second
  ↓ success
update documents.status = PENDING            ← promote, ready for vectorize
```

Failure paths:
- **DB insert fails**: storage is never touched → nothing to clean up.
  (Previously: storage had already written; a compensating
  `storage.delete` fired from the catch block — which silently failed
  if the process was killed between `storage.upload` and `db.insert`.)
- **Storage upload fails**: the row gets marked `FAILED` and the
  original error is re-thrown. No orphan storage bytes because storage
  never succeeded.

### Tests
Updated `apps/api/src/document/__tests__/document-upload.service.spec.ts`:
- Old "compensation delete" test superseded by two new cases:
  - `F-4 outbox: DB insert fails before storage is touched`
  - `F-4 outbox: storage failure marks the row FAILED`

## What was intentionally NOT done

### DocumentReconcilerService (~0.5-day add)
A cron that scans for `status = PENDING_UPLOAD` rows older than 1h and
either:
- Calls `storage.head(key)` → if found, promote to `PENDING`.
- Otherwise delete the row.

Not essential for correctness today (no process-kill path can leak
now). Adds another `@nestjs/schedule` surface with its own failure
modes. Implement when the operational need shows up.

### Presigned URL direct upload (~1.5-day add)
The plan's "large files bypass Node memory" piece. Requires:
- `RustFSStorageService.createPresignedUploadUrl(key, ttl)` wrapper.
- New `POST /documents/upload-url` returning `{ id, storageKey, uploadUrl }`.
- Frontend rewire: three-step flow (`upload-url` → `PUT` to RustFS →
  `POST /documents/:id/finalize`).
- UI state needs `PENDING_UPLOAD → READY/FAILED` surfaced to the user.

This is a proper PRD by itself — shouldn't land as a partial slice
inside F-4.

## Verification

| Check | Result |
|-------|--------|
| `pnpm --filter @finsentinel/api build` | 0 TS issues |
| `pnpm --filter @finsentinel/shared build` | 0 TS issues |
| `pnpm --filter @finsentinel/api test` (document suite) | 1570 passed |

## Progress log

- 2026-04-24: Outbox slice landed — DB-first order, PENDING_UPLOAD
  enum, FAILED-path marking, updated service spec. Reconciler +
  presigned URL flow documented as explicit followups.
