# Exec Plan: Document Upload Pipeline Hardening (P1 slice)

> **For agentic workers:** REQUIRED SUB-SKILL — superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Source PRD:** `docs/product-specs/2026-04-23-document-upload-pipeline-hardening.md`
**Branch:** `feat/2026-04-23-document-upload-hardening`
**Goal:** Close the orphan-storage hole, let `regionId` flow from the request instead of being hardcoded `US`, and let production refuse synchronous vectorization explicitly.
**Approach:** Wrap storage→DB in try/catch with compensating `storage.delete`; thread `regionId` through controller → service → vectorization metadata; add `documents.requireAsyncVectorize` typed config that throws when sync fallback is forbidden.

## What we keep

- Existing 100 MB upload size cap (`rag.parser.uploadMaxBytes`).
- Existing `FileInterceptor` + buffer-based upload (streaming/presigned is deferred).
- Synchronous fallback path in dev (when no `VectorizeProducer` is bound).

## Out of scope (defer to follow-up slices)

- Streaming/presigned-URL upload — meaningful refactor; not blocking.
- Outbox pattern (DB-first PENDING_UPLOAD state + background reconciler) — bigger architecture; defer.
- `documents` schema additions (status enum already covers PENDING / VECTORIZED / EMPTY / FAILED).

## File Map

| Path                                                              | Role                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/api/src/document/document-upload.service.ts`                | MODIFY — try/catch around storage+DB; accept `regionId`; honour `requireAsyncVectorize`. |
| `apps/api/src/document/document.controller.ts`                    | MODIFY — accept `regionId` query/form param; pass to service.                            |
| `apps/api/src/document/__tests__/document-upload.service.spec.ts` | NEW — unit tests for compensation, regionId pass-through, requireAsyncVectorize.         |
| `apps/api/src/config/rag.config.ts`                               | MODIFY — add `documents.requireAsyncVectorize: boolean` (default false).                 |
| `apps/api/src/config/__tests__/rag.config.documents.spec.ts`      | NEW — unit test the config field.                                                        |

## Tasks

---

### Task 1: typed `documents.requireAsyncVectorize` config

**Files:**

- Modify: `apps/api/src/config/rag.config.ts`
- Create: `apps/api/src/config/__tests__/rag.config.documents.spec.ts`

- [ ] **Step 1.1 — Read current rag.config.ts shape**

```
grep -n "registerAs\|documents\|parser\|uploadMaxBytes" apps/api/src/config/rag.config.ts
```

- [ ] **Step 1.2 — Write failing test**

`apps/api/src/config/__tests__/rag.config.documents.spec.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('rag.documents config', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...original };
    delete process.env.DOCUMENTS_REQUIRE_ASYNC_VECTORIZE;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('defaults requireAsyncVectorize to false (dev fallback allowed)', async () => {
    const { ragConfig } = await import('../rag.config');
    const cfg = ragConfig();
    expect(cfg.documents.requireAsyncVectorize).toBe(false);
  });

  it('parses DOCUMENTS_REQUIRE_ASYNC_VECTORIZE=true into true', async () => {
    process.env.DOCUMENTS_REQUIRE_ASYNC_VECTORIZE = 'true';
    // Re-import to re-evaluate the registerAs factory.
    const mod = await import('../rag.config?bust=' + Date.now());
    const cfg = (
      mod as { ragConfig: () => { documents: { requireAsyncVectorize: boolean } } }
    ).ragConfig();
    expect(cfg.documents.requireAsyncVectorize).toBe(true);
  });
});
```

- [ ] **Step 1.3 — Run, verify FAIL**

```
pnpm --filter @finsentinel/api vitest run src/config/__tests__/rag.config.documents.spec.ts
```

Expected: `requireAsyncVectorize` is undefined / cfg.documents missing.

- [ ] **Step 1.4 — Add to rag.config.ts**

Find the existing `registerAs('rag', () => ({ ... }))` block and add a `documents` sub-key:

```ts
documents: {
  requireAsyncVectorize:
    (process.env.DOCUMENTS_REQUIRE_ASYNC_VECTORIZE ?? 'false').toLowerCase() === 'true',
},
```

If the registerAs factory already returns a wide object, place `documents` next to `parser`. Don't change unrelated fields.

- [ ] **Step 1.5 — Run, verify PASS**

```
pnpm --filter @finsentinel/api vitest run src/config/__tests__/rag.config.documents.spec.ts
```

- [ ] **Step 1.6 — Commit**

```bash
git add apps/api/src/config/rag.config.ts \
        apps/api/src/config/__tests__/rag.config.documents.spec.ts
git commit -m "feat(config): add documents.requireAsyncVectorize gate"
```

---

### Task 2: compensation delete + regionId + requireAsyncVectorize in service

**Files:**

- Modify: `apps/api/src/document/document-upload.service.ts`
- Create: `apps/api/src/document/__tests__/document-upload.service.spec.ts`

- [ ] **Step 2.1 — Write failing tests**

`apps/api/src/document/__tests__/document-upload.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { DocumentUploadService, type UploadedFile } from '../document-upload.service';

const TEST_USER = '11111111-1111-1111-1111-111111111111';

interface BuildOpts {
  storageUploadOk?: boolean;
  dbInsertOk?: boolean;
  vectorizeProducer?: { send: Mock };
  configOverrides?: Record<string, unknown>;
}

function makeFile(): UploadedFile {
  return {
    buffer: Buffer.from('hello world'),
    mimetype: 'text/plain',
    originalname: 'note.txt',
  };
}

function buildService(opts: BuildOpts = {}) {
  const storage = {
    upload: vi.fn(
      opts.storageUploadOk === false
        ? async () => {
            throw new Error('storage down');
          }
        : async () => undefined,
    ),
    delete: vi.fn(async () => undefined),
  };
  const db = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn(
          opts.dbInsertOk === false
            ? async () => {
                throw new Error('db down');
              }
            : async () => [{ id: 'doc-1' }],
        ),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn(async () => undefined) }),
    }),
  };
  const parseService = {
    parseToCleanText: vi.fn().mockReturnValue('hello world'),
    parseToMarkdown: vi.fn().mockResolvedValue('hello world'),
  };
  const vectorService = {
    vectorize: vi.fn().mockResolvedValue(1),
  };
  const config = {
    get: vi.fn(<T>(key: string, fallback?: T): T | undefined => {
      if (key === 'rag.parser.uploadMaxBytes') return (100 * 1024 * 1024) as unknown as T;
      if (key === 'rag.documents.requireAsyncVectorize')
        return ((opts.configOverrides?.requireAsyncVectorize as boolean) ?? false) as unknown as T;
      return fallback;
    }),
  };

  const svc = new DocumentUploadService(
    db as never,
    storage as never,
    parseService as never,
    vectorService as never,
    config as never,
    opts.vectorizeProducer as never,
  );
  return { svc, storage, db, parseService, vectorService, config };
}

describe('DocumentUploadService — compensation + regionId + async gate (P1-1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes the storage object when DB insert fails (no orphans)', async () => {
    const { svc, storage } = buildService({ dbInsertOk: false });
    await expect(svc.upload(makeFile(), TEST_USER, 'GENERAL')).rejects.toThrow();
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledTimes(1);
    const deletedKey = (storage.delete as Mock).mock.calls[0]![0] as string;
    expect(deletedKey).toMatch(/^documents\//);
  });

  it('does not call storage.delete when DB insert succeeds', async () => {
    const { svc, storage } = buildService({
      vectorizeProducer: { send: vi.fn(async () => undefined) },
    });
    await svc.upload(makeFile(), TEST_USER, 'GENERAL');
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('threads regionId through to the DB insert and vectorization metadata', async () => {
    const { svc, db, vectorService } = buildService();
    await svc.upload(makeFile(), TEST_USER, 'GENERAL', undefined, 'EU');
    const valuesArg = (db.insert as Mock).mock.results[0]!.value.values.mock.calls[0]![0];
    expect(valuesArg.regionId).toBe('EU');
    const vectorMeta = (vectorService.vectorize as Mock).mock.calls[0]![2];
    expect(vectorMeta.region_id).toBe('EU');
  });

  it("falls back to 'US' when regionId is not provided (preserves prior behavior)", async () => {
    const { svc, db } = buildService();
    await svc.upload(makeFile(), TEST_USER, 'GENERAL');
    const valuesArg = (db.insert as Mock).mock.results[0]!.value.values.mock.calls[0]![0];
    expect(valuesArg.regionId).toBe('US');
  });

  it('refuses sync fallback when requireAsyncVectorize=true and no producer is bound', async () => {
    const { svc } = buildService({ configOverrides: { requireAsyncVectorize: true } });
    await expect(svc.upload(makeFile(), TEST_USER, 'GENERAL')).rejects.toThrow(
      /async vectorization required/i,
    );
  });

  it('uses the queue when requireAsyncVectorize=true and a producer is bound', async () => {
    const send = vi.fn(async () => undefined);
    const { svc } = buildService({
      configOverrides: { requireAsyncVectorize: true },
      vectorizeProducer: { send },
    });
    const result = await svc.upload(makeFile(), TEST_USER, 'GENERAL');
    expect(send).toHaveBeenCalledWith('doc-1');
    expect(result.status).toBe('PENDING');
  });
});
```

- [ ] **Step 2.2 — Run, verify FAIL**

```
pnpm --filter @finsentinel/api vitest run src/document/__tests__/document-upload.service.spec.ts
```

Expected: signature mismatch (no regionId param) and orphan-not-deleted on DB failure.

- [ ] **Step 2.3 — Refactor `document-upload.service.ts`**

Update the `upload` signature and body:

```ts
async upload(
  file: UploadedFile,
  userId: string,
  docType: string,
  sector?: string,
  regionId: string = 'US',
): Promise<UploadResult> {
  this.validate(file);

  const requireAsync = this.config.get<boolean>(
    'rag.documents.requireAsyncVectorize',
    false,
  );
  if (requireAsync && !this.vectorizeProducer) {
    throw new Error(
      'async vectorization required: rag.documents.requireAsyncVectorize=true ' +
      'but no VectorizeProducer is bound (QueueModule must be loaded)',
    );
  }

  // Generate storage key.
  const timestamp = Date.now();
  const safeFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = `documents/${userId}/${timestamp}_${safeFileName}`;

  // Storage upload first — DB write below; if DB write fails, compensate by
  // deleting the storage object so we don't leave orphans.
  await this.storage.upload(storageKey, file.buffer, file.mimetype);
  this.logger.log(`Uploaded file to storage: ${storageKey}`);

  let doc: { id: string };
  try {
    const insertResult = await this.db
      .insert(documents)
      .values({
        fileName: safeFileName,
        originalFileName: file.originalname,
        docType,
        status: 'PENDING',
        sector: sector ?? null,
        regionId,
        userId,
        fileSize: file.buffer.length,
        storageKey,
        storageTier: 'HOT',
      })
      .returning({ id: documents.id });
    const inserted = insertResult[0];
    if (!inserted) throw new Error('Failed to insert document record');
    doc = inserted;
  } catch (err) {
    // Compensating delete — best-effort. Don't mask the original error.
    try {
      await this.storage.delete(storageKey);
      this.logger.warn(
        `Rolled back orphan storage object after DB failure: ${storageKey}`,
      );
    } catch (cleanupErr) {
      this.logger.error(
        `Compensating storage.delete failed for ${storageKey}: ${cleanupErr}`,
      );
    }
    throw err;
  }

  this.logger.log(`Created document record: ${doc.id} (status=PENDING)`);

  if (this.vectorizeProducer) {
    await this.vectorizeProducer.send(doc.id);
    return { id: doc.id, status: 'PENDING' };
  }

  // Synchronous fallback (dev only). Production should set
  // DOCUMENTS_REQUIRE_ASYNC_VECTORIZE=true to force the assertion above.
  const SIDECAR_MIMES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]);

  try {
    const text = SIDECAR_MIMES.has(file.mimetype)
      ? await this.parseService.parseToMarkdown(file.buffer, file.mimetype, file.originalname)
      : this.parseService.parseToCleanText(file.buffer, file.mimetype);
    const uploadDate = new Date().toISOString().slice(0, 10);

    if (text) {
      const chunkCount = await this.vectorService.vectorize(doc.id, text, {
        doc_type: docType,
        sector: sector ?? '',
        region_id: regionId,
        source: file.originalname,
        date: uploadDate,
        __originalFileName: file.originalname,
      });

      await this.db
        .update(documents)
        .set({ status: 'VECTORIZED', chunkCount })
        .where(eq(documents.id, doc.id));

      this.logger.log(`Document ${doc.id} vectorized: ${chunkCount} chunks`);
      return { id: doc.id, status: 'VECTORIZED' };
    }

    await this.db
      .update(documents)
      .set({ status: 'EMPTY' })
      .where(eq(documents.id, doc.id));
    return { id: doc.id, status: 'EMPTY' };
  } catch (error) {
    this.logger.error(`Vectorization failed for ${doc.id}: ${error}`);
    await this.db
      .update(documents)
      .set({ status: 'FAILED' })
      .where(eq(documents.id, doc.id));
    return { id: doc.id, status: 'FAILED' };
  }
}
```

- [ ] **Step 2.4 — Run, verify PASS**

```
pnpm --filter @finsentinel/api vitest run src/document/__tests__/document-upload.service.spec.ts
```

Expected: 6 tests PASS.

- [ ] **Step 2.5 — Commit**

```bash
git add apps/api/src/document/document-upload.service.ts \
        apps/api/src/document/__tests__/document-upload.service.spec.ts
git commit -m "feat(documents): compensation delete + regionId + async-vectorize gate"
```

---

### Task 3: thread regionId through controller

**Files:**

- Modify: `apps/api/src/document/document.controller.ts`

- [ ] **Step 3.1 — Edit `upload` signature**

```ts
@Post()
@RateLimit({ limit: 20, windowSecs: 60 })
@UseGuards(RateLimitGuard)
@UseInterceptors(FileInterceptor('file'))
async upload(
  @CurrentUser() user: CurrentUserPayload,
  @UploadedFile() file: MulterFile | undefined,
  @Query('docType') docType?: string,
  @Query('sector') sector?: string,
  @Query('regionId') regionId?: string,
) {
  if (!file) {
    throw new BadRequestException('No file uploaded');
  }

  return this.uploadService.upload(
    {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
    },
    user.userId,
    docType ?? 'GENERAL',
    sector,
    regionId, // undefined → service falls back to 'US'
  );
}
```

- [ ] **Step 3.2 — Verify typecheck**

```
pnpm --filter @finsentinel/api typecheck
```

- [ ] **Step 3.3 — Commit**

```bash
git add apps/api/src/document/document.controller.ts
git commit -m "feat(documents): accept regionId query param on upload"
```

---

### Task 4: full verification + progress log

- [ ] **Step 4.1 — Full API test suite**

```
pnpm --filter @finsentinel/api typecheck
pnpm --filter @finsentinel/api vitest run
```

Expected: green (modulo the pre-existing `cli-import-env` flake noted in the auth PRD progress log).

- [ ] **Step 4.2 — Append progress log to PRD**

Append `## 8. Implementation Progress Log` to `docs/product-specs/2026-04-23-document-upload-pipeline-hardening.md`:

```
## 8. Implementation Progress Log

- 2026-04-24: branch `feat/2026-04-23-document-upload-hardening` opened.
- 2026-04-24: implemented Tasks 1–3 per `docs/exec-plans/2026-04-23-document-upload-hardening.md`.
  - Task 1: typed `rag.documents.requireAsyncVectorize` config (default false).
  - Task 2: compensation `storage.delete` on DB-insert failure; `regionId` parameter added to service signature; sync fallback refused when `requireAsyncVectorize=true` and no producer is bound.
  - Task 3: controller accepts `?regionId=` query param and forwards to service (undefined → service default 'US').
- Verification: 6 unit tests in `document-upload.service.spec.ts` all green; typecheck clean.
- Deferred:
  - Streaming/presigned-URL upload (significant refactor; not blocking).
  - Outbox pattern (DB-first PENDING_UPLOAD + reconciler).
  - regionId metadata extraction from PDF headers / SEC scraper inference.
```

- [ ] **Step 4.3 — Commit progress log**

```bash
git add docs/product-specs/2026-04-23-document-upload-pipeline-hardening.md
git commit -m "docs(documents): log upload-pipeline hardening implementation progress"
```

---

## Self-Review Checklist

- [x] Spec coverage: §5.1 size cap (already in place — kept as-is). §5.2 compensation deletion → Task 2. §5.3 `requireAsyncVectorize` → Tasks 1+2. §5.4 regionId → Tasks 2+3.
- [x] No placeholders: every step has runnable code or a runnable command.
- [x] Type consistency: `requireAsync`, `regionId`, compensation `storage.delete` defined once and reused throughout.
- [x] Verification: each task ends in tests + commit.
- [x] Scope discipline: only document-upload service/controller, one new config field, two new spec files. No drive-by refactors of the wider document subsystem.

## Risks Going In

- The `regionId: string = 'US'` default keeps the previous behavior — but watch for any caller (e.g. the PDF scraper) that relied on the hardcoded value being centralized in the service. If any caller passes a different region, behavior changes; the test in 2.3 catches the explicit-pass case.
- `storage.delete` is best-effort in `HybridStorageService` (logs but doesn't throw). The compensation try/catch swallows cleanup errors and rethrows the original DB error so the user-facing failure mode stays "upload failed" and orphans surface only as logs.
- The new `requireAsyncVectorize` flag is OFF by default; only production deployments need to flip it. Be sure the runbook for the next deploy mentions enabling it.
