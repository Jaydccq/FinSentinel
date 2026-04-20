# R5 — PDF/Word Ingestion via Markdown Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept PDF and Word uploads end-to-end by routing them through a new parser sidecar that returns structure-preserving Markdown, without shipping a real PDF parser inside this phase.

**Architecture:** New FastAPI sidecar `services/parser/` mirrors the pattern of `services/reranker/` (Dockerfile, `/health` endpoint, zod-validated response contract). The TypeScript side gets a typed client with timeout + circuit breaker, the upload MIME whitelist gains PDF/DOC/DOCX, and the `VectorizeConsumer` routes PDF/Word MIMEs through the sidecar. The sidecar ships as a **stub** that returns a fixed Markdown payload — real parsing (MinerU / pdfplumber / commercial OCR) is a follow-up and is not in scope here. Critical: the distribution artefacts (Dockerfile, compose service, health endpoint, CI build) ship **with** the stub, not deferred, so operators can stand up the service the same day the code merges.

**Tech Stack:** FastAPI, Pydantic, Docker, BullMQ (existing), zod (existing), NestJS, Drizzle.

**Master plan reference:** `docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md:543-630`.

---

## File Structure

- **Create** `services/parser/app.py` — FastAPI entrypoint mirroring `services/reranker/app.py`.
- **Create** `services/parser/routers/parse.py` — `POST /parse` stub router.
- **Create** `services/parser/Dockerfile` — mirror reranker.
- **Create** `services/parser/requirements.txt` — FastAPI + uvicorn + python-multipart.
- **Create** `services/parser/clients/__init__.py` — empty placeholder.
- **Create** `services/parser/CLAUDE.md` — one-liner pointing to the reranker skeleton.
- **Modify** `docker-compose.yml` — add `parser` service on port 8110.
- **Create** `.github/workflows/parser-build.yml` — mirror the reranker image build.
- **Create** `apps/api/src/document/parser-sidecar.client.ts` — typed client (zod schema, timeout, circuit breaker).
- **Modify** `apps/api/src/config/rag.config.ts` — add `parser` section (`url`, `timeoutMs`, `minMarkdownChars`, `uploadMaxBytes`).
- **Modify** `apps/api/src/document/document-upload.service.ts:13-21` — extend `ALLOWED_MIME_TYPES`, bump `MAX_FILE_SIZE` (or replace with config-backed cap).
- **Modify** `apps/api/src/document/document-parse.service.ts:53-60` — delete the "returns empty string for PDF" branch, delegate to the sidecar client when injected.
- **Modify** `apps/api/src/queue/vectorize.consumer.ts:107-108` — route PDF/Word MIMEs through `ParserSidecarClient.parse()`.
- **Modify** `apps/api/src/document/structured-document.ts` — extend metadata to include `sourceMimeType`, `pageCount`, `parserVersion`.
- **Create** `apps/api/src/document/__tests__/parser-sidecar.client.spec.ts`.
- **Create** `apps/api/src/queue/__tests__/vectorize.consumer.pdf.spec.ts`.
- **Modify** `apps/api/src/document/__tests__/document-upload.service.spec.ts` — accepts PDF MIME, rejects oversized PDF, rejects sidecar-empty.
- **Create** `apps/api/test/fixtures/pdf/10k-sample-stub.txt` — a small fixture file the stub sidecar echoes back as Markdown (no real PDF needed for plumbing tests).
- **Modify** `docs/runbooks/2026-04-19-rag-wave2-rollout.md` — document `PARSER_URL`, the sidecar contract version, and the explicit non-exit-criterion that stub-based E2E is NOT a quality check.

---

## Task R5.1a: Define the sidecar contract in TypeScript first (zod schema)

**Files:**
- Create: `apps/api/src/document/parser-sidecar.client.ts`.
- Test: `apps/api/src/document/__tests__/parser-sidecar.client.spec.ts`.

- [ ] **Step 1: Write a failing test for the schema**

```ts
// apps/api/src/document/__tests__/parser-sidecar.client.spec.ts
import { ParserSidecarResponse } from '../parser-sidecar.client';

describe('ParserSidecarResponse zod schema', () => {
  it('accepts a well-formed sidecar response', () => {
    const payload = {
      markdown: '# Title\n\nParagraph.',
      metadata: {
        pageCount: 3,
        headings: [{ level: 1, text: 'Title', pageStart: 1 }],
        tableCount: 0,
        parserVersion: 'stub-0.1',
        sourceMimeType: 'application/pdf',
      },
    };
    expect(() => ParserSidecarResponse.parse(payload)).not.toThrow();
  });

  it('rejects empty markdown', () => {
    const payload = {
      markdown: '',
      metadata: { pageCount: 0, headings: [], tableCount: 0, parserVersion: 'x', sourceMimeType: 'application/pdf' },
    };
    expect(() => ParserSidecarResponse.parse(payload)).toThrow();
  });

  it('rejects missing parserVersion', () => {
    const payload: any = {
      markdown: 'x',
      metadata: { pageCount: 0, headings: [], tableCount: 0, sourceMimeType: 'application/pdf' },
    };
    expect(() => ParserSidecarResponse.parse(payload)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @finsentinel/api test -- parser-sidecar.client`
Expected: FAIL — file missing.

- [ ] **Step 3: Implement the schema + stub client**

```ts
// apps/api/src/document/parser-sidecar.client.ts
import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

export const ParserSidecarResponse = z.object({
  markdown: z.string().min(1),
  metadata: z.object({
    pageCount: z.number().int().nonnegative(),
    headings: z.array(z.object({
      level: z.number().int().min(1).max(6),
      text: z.string(),
      pageStart: z.number().int().nullable(),
    })),
    tableCount: z.number().int().nonnegative(),
    parserVersion: z.string().min(1),
    sourceMimeType: z.string().min(1),
  }),
});

export type ParserSidecarResponse = z.infer<typeof ParserSidecarResponse>;

export interface ParserSidecarConfig {
  url: string;
  timeoutMs: number;
  minMarkdownChars: number;
}

@Injectable()
export class ParserSidecarClient {
  private readonly logger = new Logger(ParserSidecarClient.name);
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(@Inject('PARSER_SIDECAR_CONFIG') private readonly config: ParserSidecarConfig) {}

  async parse(buffer: Buffer, mimeType: string, fileName: string): Promise<ParserSidecarResponse> {
    if (Date.now() < this.circuitOpenUntil) {
      throw new Error('PARSER_CIRCUIT_OPEN');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mimeType }), fileName);
      const res = await fetch(`${this.config.url}/parse`, { method: 'POST', body: form, signal: controller.signal });
      if (!res.ok) throw new Error(`PARSER_HTTP_${res.status}`);
      const body = ParserSidecarResponse.parse(await res.json());
      if (body.markdown.length < this.config.minMarkdownChars) {
        throw new Error('PARSER_EMPTY_OUTPUT');
      }
      this.consecutiveFailures = 0;
      return body;
    } catch (err) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3) {
        this.circuitOpenUntil = Date.now() + 30_000;
        this.logger.warn('parser sidecar circuit open for 30s');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run schema tests**

Run: `pnpm --filter @finsentinel/api test -- parser-sidecar.client`
Expected: PASS 3/3.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/document/parser-sidecar.client.ts apps/api/src/document/__tests__/parser-sidecar.client.spec.ts
git commit -m "feat(rag): parser sidecar client + zod contract (R5.1)"
```

---

## Task R5.1b: Circuit-breaker + timeout behavioural tests

**Files:**
- Modify: `apps/api/src/document/__tests__/parser-sidecar.client.spec.ts` — add behavioural tests with a mocked `fetch`.

- [ ] **Step 1: Add the failing tests**

```ts
describe('ParserSidecarClient behaviour', () => {
  beforeEach(() => { (global as any).fetch = jest.fn(); });

  it('times out when sidecar never responds', async () => {
    (global as any).fetch = jest.fn().mockImplementation(
      (_url, opts: any) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    const client = new ParserSidecarClient({ url: 'http://x', timeoutMs: 50, minMarkdownChars: 10 });
    await expect(client.parse(Buffer.from('pdf'), 'application/pdf', 'x.pdf')).rejects.toThrow();
  });

  it('opens circuit after 3 consecutive failures', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('500'));
    const client = new ParserSidecarClient({ url: 'http://x', timeoutMs: 1000, minMarkdownChars: 10 });
    for (let i = 0; i < 3; i++) await expect(client.parse(Buffer.from('x'), 'application/pdf', 'x.pdf')).rejects.toThrow();
    await expect(client.parse(Buffer.from('x'), 'application/pdf', 'x.pdf')).rejects.toThrow('PARSER_CIRCUIT_OPEN');
  });

  it('rejects when sidecar markdown is under threshold', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        markdown: 'x',
        metadata: { pageCount: 1, headings: [], tableCount: 0, parserVersion: 'stub', sourceMimeType: 'application/pdf' },
      }),
    });
    const client = new ParserSidecarClient({ url: 'http://x', timeoutMs: 1000, minMarkdownChars: 50 });
    await expect(client.parse(Buffer.from('x'), 'application/pdf', 'x.pdf')).rejects.toThrow('PARSER_EMPTY_OUTPUT');
  });
});
```

- [ ] **Step 2: Run to verify pass (implementation already covers these)**

Run: `pnpm --filter @finsentinel/api test -- parser-sidecar.client`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/document/__tests__/parser-sidecar.client.spec.ts
git commit -m "test(rag): parser sidecar circuit + timeout + empty-output behaviour"
```

---

## Task R5.2: Stub sidecar implementation + distribution artefacts

**Files:**
- Create: `services/parser/app.py`, `services/parser/routers/parse.py`, `services/parser/Dockerfile`, `services/parser/requirements.txt`.
- Modify: `docker-compose.yml`.
- Create: `.github/workflows/parser-build.yml`.

- [ ] **Step 1: Inspect the reranker skeleton as reference**

Read `services/reranker/app.py`, `services/reranker/Dockerfile`, and (from git) the existing `.github/workflows/*reranker*.yml` if present. Mirror layout.

- [ ] **Step 2: Write the stub sidecar**

```python
# services/parser/app.py
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI

from routers.parse import router as parse_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="FinSentinel Parser Sidecar", lifespan=lifespan)
app.include_router(parse_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "stub-0.1"}
```

```python
# services/parser/routers/parse.py
from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()


class Heading(BaseModel):
    level: int
    text: str
    pageStart: Optional[int] = None


class ParseMetadata(BaseModel):
    pageCount: int
    headings: List[Heading]
    tableCount: int
    parserVersion: str
    sourceMimeType: str


class ParseResponse(BaseModel):
    markdown: str
    metadata: ParseMetadata


@router.post("/parse", response_model=ParseResponse)
async def parse(file: UploadFile = File(...)):
    raw = await file.read()
    # STUB: produce deterministic Markdown from the filename + byte count.
    # A real parser would run MinerU / pdfplumber / commercial OCR here.
    text = (
        f"# {file.filename}\n\n"
        "## Section 1\n\n"
        f"Stub parser output for {len(raw)} bytes.\n\n"
        "## Section 2\n\nPlaceholder content for plumbing tests.\n"
    )
    return ParseResponse(
        markdown=text,
        metadata=ParseMetadata(
            pageCount=1,
            headings=[
                Heading(level=1, text=file.filename or "", pageStart=1),
                Heading(level=2, text="Section 1", pageStart=1),
                Heading(level=2, text="Section 2", pageStart=1),
            ],
            tableCount=0,
            parserVersion="stub-0.1",
            sourceMimeType=file.content_type or "application/octet-stream",
        ),
    )
```

```txt
# services/parser/requirements.txt
fastapi==0.115.0
uvicorn==0.30.6
python-multipart==0.0.9
pydantic==2.9.2
```

```Dockerfile
# services/parser/Dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8110

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8110"]
```

- [ ] **Step 3: Add to docker-compose**

In `docker-compose.yml` at the services block, append:

```yaml
  parser:
    build: ./services/parser
    ports:
      - "8110:8110"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8110/health').read()"]
      interval: 30s
      timeout: 5s
      retries: 3
```

- [ ] **Step 4: CI build workflow**

```yaml
# .github/workflows/parser-build.yml
name: parser-sidecar-build

on:
  pull_request:
    paths: [ 'services/parser/**', '.github/workflows/parser-build.yml' ]
  push:
    branches: [ main ]
    paths: [ 'services/parser/**' ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build parser image
        run: docker build -t finsentinel-parser:ci services/parser
      - name: Start and smoke-test
        run: |
          docker run -d --name parser -p 8110:8110 finsentinel-parser:ci
          for i in {1..20}; do curl -fsS http://localhost:8110/health && break; sleep 1; done
          curl -fsS -F file=@services/parser/app.py http://localhost:8110/parse | python -m json.tool
          docker rm -f parser
```

- [ ] **Step 5: Smoke-test locally**

Run: `docker build -t finsentinel-parser:dev services/parser && docker run --rm -p 8110:8110 -d --name parser-test finsentinel-parser:dev`

Then: `curl -fsS http://localhost:8110/health` — should print `{"status":"ok","version":"stub-0.1"}`.

Cleanup: `docker rm -f parser-test`.

- [ ] **Step 6: Commit**

```bash
git add services/parser/ docker-compose.yml .github/workflows/parser-build.yml
git commit -m "feat(rag): parser sidecar stub with Dockerfile, compose, and CI build (R5.2)"
```

---

## Task R5.3: Config wiring + MIME whitelist + upload size cap

**Files:**
- Modify: `apps/api/src/config/rag.config.ts`.
- Modify: `apps/api/src/document/document-upload.service.ts:10-21`.
- Modify: `apps/api/src/document/document-upload.service.ts:154-173` — validate() to use config-backed cap.

- [ ] **Step 1: Add config**

```ts
// apps/api/src/config/rag.config.ts — append inside ragConfig export
parser: {
  url: process.env['PARSER_URL'] ?? 'http://localhost:8110',
  timeoutMs: Number(process.env['RAG_PARSER_TIMEOUT_MS']) || 30_000,
  minMarkdownChars: Number(process.env['RAG_PARSER_MIN_MARKDOWN_CHARS']) || 50,
  uploadMaxBytes: Number(process.env['RAG_UPLOAD_MAX_BYTES']) || 100 * 1024 * 1024,
},
```

- [ ] **Step 2: Extend upload MIME whitelist**

Edit `apps/api/src/document/document-upload.service.ts:13-21`:

```ts
const ALLOWED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'application/json',
  'application/xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
```

Replace the hardcoded `MAX_FILE_SIZE` constant with a config read at the top of the class:

```ts
import { ConfigService } from '@nestjs/config';
// ... in constructor:
@Inject(ConfigService) private readonly config: ConfigService,

// Replace line 10's `MAX_FILE_SIZE` usage in validate() with:
const maxBytes = this.config.get<number>('rag.parser.uploadMaxBytes', 100 * 1024 * 1024);
if (file.buffer.length > maxBytes) {
  throw new BadRequestException(
    `File exceeds maximum size of ${maxBytes / (1024 * 1024)} MB`,
  );
}
```

- [ ] **Step 3: Write the failing upload test**

In `apps/api/src/document/__tests__/document-upload.service.spec.ts`, add:

```ts
it('accepts application/pdf MIME', async () => {
  const file = { buffer: Buffer.alloc(1000), mimetype: 'application/pdf', originalname: 'sample.pdf' };
  await expect(service.upload(file as any, 'user-1', 'SEC_FILING')).resolves.toHaveProperty('id');
});

it('rejects oversized PDF before reaching sidecar', async () => {
  const file = { buffer: Buffer.alloc(101 * 1024 * 1024), mimetype: 'application/pdf', originalname: 'big.pdf' };
  await expect(service.upload(file as any, 'user-1', 'SEC_FILING')).rejects.toThrow(/exceeds maximum size/);
});
```

- [ ] **Step 4: Run**

Run: `pnpm --filter @finsentinel/api test -- document-upload`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/rag.config.ts apps/api/src/document/document-upload.service.ts apps/api/src/document/__tests__/document-upload.service.spec.ts
git commit -m "feat(rag): accept PDF/Word MIMEs; config-backed upload size cap (R5.3)"
```

---

## Task R5.4: Route PDF/Word MIMEs through the sidecar in the VectorizeConsumer

**Files:**
- Modify: `apps/api/src/queue/vectorize.consumer.ts:104-117`.
- Create: `apps/api/src/queue/__tests__/vectorize.consumer.pdf.spec.ts`.

- [ ] **Step 1: Write the failing consumer-routing test**

```ts
// apps/api/src/queue/__tests__/vectorize.consumer.pdf.spec.ts
describe('VectorizeConsumer PDF routing', () => {
  it('routes application/pdf through ParserSidecarClient, not DocumentParseService', async () => {
    const sidecar = { parse: jest.fn().mockResolvedValue({
      markdown: '# Sample\n\nParsed body with more than fifty characters to meet the threshold.',
      metadata: { pageCount: 1, headings: [], tableCount: 0, parserVersion: 'stub-0.1', sourceMimeType: 'application/pdf' },
    })};
    const parseService = { parseToCleanText: jest.fn() };
    // ...build consumer with these stubs; invoke process(fakeJob)
    expect(sidecar.parse).toHaveBeenCalledTimes(1);
    expect(parseService.parseToCleanText).not.toHaveBeenCalled();
  });

  it('marks document FAILED when sidecar returns PARSER_EMPTY_OUTPUT', async () => {
    const sidecar = { parse: jest.fn().mockRejectedValue(new Error('PARSER_EMPTY_OUTPUT')) };
    // ...assert db.update status=FAILED
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @finsentinel/api test -- vectorize.consumer.pdf`
Expected: FAIL.

- [ ] **Step 3: Update the consumer**

Edit `apps/api/src/queue/vectorize.consumer.ts`:

```ts
import { ParserSidecarClient } from '../document/parser-sidecar.client';

constructor(
  // ...existing deps...
  @Optional() @Inject(ParserSidecarClient) private readonly parserSidecar?: ParserSidecarClient,
) {}

// Replace lines 104-117:
const mimeType = this.guessMimeType(doc.originalFileName);
const parseViaSidecar = ['application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mimeType);

let text: string;
try {
  if (parseViaSidecar && this.parserSidecar) {
    const result = await this.parserSidecar.parse(content, mimeType, doc.originalFileName);
    text = result.markdown;
  } else {
    text = this.parseService.parseToCleanText(content, mimeType);
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  await this.db.update(documents).set({ status: 'FAILED' }).where(eq(documents.id, docId));
  this.logger.error(`Document ${docId} parse failed: ${msg}`);
  throw err;  // let BullMQ retry per its policy
}
```

Also extend `guessMimeType()` to include DOC/DOCX extensions:

```ts
doc: 'application/msword',
docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
```

- [ ] **Step 4: Run tests**

Run these in parallel:
- `pnpm --filter @finsentinel/api test -- vectorize.consumer`
- `pnpm --filter @finsentinel/api test -- document`

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/queue/vectorize.consumer.ts apps/api/src/queue/__tests__/vectorize.consumer.pdf.spec.ts
git commit -m "feat(rag): route PDF/Word MIMEs through parser sidecar in VectorizeConsumer (R5.4)"
```

---

## Task R5.5: Remove the "returns empty string" PDF branch from DocumentParseService

**Files:**
- Modify: `apps/api/src/document/document-parse.service.ts:53-60`.
- Test: extend `apps/api/src/document/__tests__/document-parse.service.spec.ts`.

- [ ] **Step 1: Update the sync path**

Inject `ParserSidecarClient` as an optional dep into `DocumentParseService` and, on the sync upload path, call the sidecar the same way the consumer does. If the sidecar is absent (dev mode without compose), throw a clear error rather than silently returning `''`.

```ts
// document-parse.service.ts
if (normalizedMime === 'application/pdf' || normalizedMime === 'application/msword' || normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
  if (!this.parserSidecar) {
    throw new Error('PARSER_SIDECAR_UNAVAILABLE');
  }
  // Note: parseToCleanText is sync; the sync upload path is already marked legacy.
  // Adding an async parseToMarkdown() is cleaner — see below.
  throw new Error('USE_ASYNC_PARSER_PATH');
}
```

Add a new async method:

```ts
async parseToMarkdown(content: Buffer, mimeType: string, fileName: string): Promise<string> {
  if (!this.parserSidecar) throw new Error('PARSER_SIDECAR_UNAVAILABLE');
  const result = await this.parserSidecar.parse(content, mimeType, fileName);
  return this.textCleaning.clean(result.markdown);
}
```

Update `DocumentUploadService` sync fallback (lines 114-141) to use `parseToMarkdown` for PDF/Word paths.

- [ ] **Step 2: Run full document suite**

Run: `pnpm --filter @finsentinel/api test -- document`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/document/document-parse.service.ts apps/api/src/document/document-upload.service.ts apps/api/src/document/__tests__/document-parse.service.spec.ts
git commit -m "feat(rag): replace empty-PDF branch with sidecar-backed parseToMarkdown (R5.5)"
```

---

## Task R5.6: Propagate structural metadata (headings, pageCount) into the chunker

**Files:**
- Modify: `apps/api/src/document/structured-document.ts` — metadata extension.
- Modify: `apps/api/src/document/markdown-structure.service.ts` — accept optional sidecar-provided headings.
- Test: inline updates to existing `markdown-structure` spec.

- [ ] **Step 1: Extend the structured document metadata**

Add optional fields:

```ts
export interface StructuredDocument {
  // ...existing...
  sourceMimeType?: string;
  pageCount?: number;
  parserVersion?: string;
}
```

- [ ] **Step 2: Wire headings into `MarkdownStructureService.parse()`**

Add an overload or optional second arg that accepts a pre-computed headings array (from the sidecar response). If provided, use it as the section spine instead of regex heading detection.

```ts
parse(text: string, hints?: { headings?: Heading[]; pageCount?: number; sourceMimeType?: string; parserVersion?: string }): StructuredDocument {
  // ...existing logic...
  if (hints?.headings?.length) {
    // Prefer hints over regex when the sidecar has already identified structure.
  }
  // ...return with the extra metadata fields set from hints.
}
```

- [ ] **Step 3: Update the consumer to pass hints through**

In `vectorize.consumer.ts`, after calling the sidecar, feed the sidecar metadata to `markdownStructure.parse()` — but since the current DI is `DocumentVectorService` -> `MarkdownStructureService`, route the hints through `vectorService.vectorize` as a new optional `parseHints` arg.

Alternative (lower-risk): persist sidecar metadata into `documents.meta` at the point of call, and let `MarkdownStructureService` stay as-is for now. Mark the heading-spine integration as a TODO for R6 (where it naturally belongs — R6 builds the `report-chunker.ts` that consumes the heading spine).

**Choose alternative for this phase.** Persist `pageCount`, `parserVersion`, `sourceMimeType` on the document metadata only; R6 will wire heading spine into the chunker.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/document/structured-document.ts apps/api/src/document/markdown-structure.service.ts
git commit -m "feat(rag): thread sidecar metadata onto StructuredDocument (pageCount, parserVersion)"
```

---

## Task R5.7: E2E plumbing test against the stub sidecar

**Files:**
- Create: `apps/api/test/fixtures/pdf/10k-sample-stub.txt` — dummy bytes (the stub ignores content and returns fixed Markdown, so any non-empty buffer works).
- Add an integration-style test behind an env gate `RAG_PARSER_E2E=1` that:
  1. Assumes `docker compose up parser` is already running on port 8110.
  2. Uploads the fixture buffer as `application/pdf`.
  3. Asserts the document reaches `status='VECTORIZED'` and at least one chunk exists.

- [ ] **Step 1: Write the gated test**

```ts
// apps/api/src/document/__tests__/upload-pdf-e2e.spec.ts
const skip = process.env.RAG_PARSER_E2E !== '1';
(skip ? describe.skip : describe)('PDF upload E2E via stub sidecar', () => {
  it('ingests a fake PDF end-to-end', async () => {
    // full Nest testing module, real HybridStorageService in memory mode, real DB
    // upload => expect status vectorized, expect chunks > 0
  });
});
```

- [ ] **Step 2: Document how to run it in the runbook**

Append to `docs/runbooks/2026-04-19-rag-wave2-rollout.md`:

```md
### R5 — Parser sidecar

- `PARSER_URL` (default `http://localhost:8110`)
- `RAG_PARSER_TIMEOUT_MS` (default 30_000)
- `RAG_PARSER_MIN_MARKDOWN_CHARS` (default 50)
- `RAG_UPLOAD_MAX_BYTES` (default 100 MiB)

**Stub vs real parser:** the merged sidecar is a stub that returns fixed Markdown.
Real parsing (MinerU, pdfplumber, commercial OCR) is tracked as a separate
follow-up. Do NOT interpret the R5 E2E pass as "PDF ingestion works in
production" — it proves the *plumbing* works.

**Run E2E locally:**
```bash
docker compose up -d parser
RAG_PARSER_E2E=1 pnpm --filter @finsentinel/api test -- upload-pdf-e2e
```
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/document/__tests__/upload-pdf-e2e.spec.ts docs/runbooks/2026-04-19-rag-wave2-rollout.md
git commit -m "feat(rag): E2E plumbing test for PDF upload via stub sidecar (R5.7)"
```

---

## Exit Criteria

- API accepts PDF uploads without error against the **stub** sidecar.
- `VectorizeConsumer` routes PDF/Word MIMEs to `ParserSidecarClient.parse()` and persists non-empty Markdown.
- Sidecar contract is versioned; `ParserSidecarResponse` zod schema is the source of truth on the TS side; Pydantic `ParseResponse` on the Python side.
- Distribution artefacts (Dockerfile, compose service, CI build) land with the stub, not deferred.
- Sidecar health endpoint returns 200 during compose health-checks.
- Fallback on sidecar outage: upload rejected with a clear error code; queued ingestion routes to retry/failed status.
- Runbook documents `PARSER_URL`, `RAG_PARSER_TIMEOUT_MS`, and the stub-vs-real distinction.
- Flag-off regression snapshot unchanged.
- Typecheck + rag + document + queue tests green.

**Explicit non-exit-criterion:** real PDF/Word ingestion quality (layout, tables, headings, images) is NOT validated by R5.

## Risks

- **Stub masks real quality problems.** Operators who see R5 ship may assume production PDFs work. Mitigation: the runbook block above; dashboard panel reading `rag_vectorizations_total{source_type='document',status='success'}` stays flat when a real PDF arrives because the stub returns fixed output regardless of input.
- **Large uploads crossing the network.** `RAG_UPLOAD_MAX_BYTES=100 MiB` default. If raised later, the NestJS request body parser limit must be raised too. Track in tech-debt-tracker.
- **Sidecar cold-start.** FastAPI boots in ~2s; a new compose environment's first upload can time out at 30s if CI has slow Docker pulls. CI workflow's readiness loop (20 attempts, 1s each) covers this.
