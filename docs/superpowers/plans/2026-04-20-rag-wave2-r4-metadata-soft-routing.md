# R4 — Metadata Soft Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `MetadataPreFilterService` from a passthrough to a regex-first, LLM-fallback query-entity extractor that produces soft/hard filters per lane, improving `exact_lookup` bucket precision without regressing other buckets.

**Architecture:** Two sub-phases. **R4.0** extends ingestion metadata so chunks carry `issuerName`/`tickers` alongside the existing `doc_type`/`sector`/`region_id`/`source`/`date`, plus a backfill CLI. **R4.1–R4.5** builds `QueryEntityExtractorService` (regex hits with confidence scores, LLM fallback gated by concurrency/timeouts/circuit-breaker/env flag) and upgrades `MetadataPreFilterService` to apply soft-or-hard filters based on a confidence threshold, with per-query-class minimum-candidates guardrails to prevent empty result sets.

**Tech Stack:** NestJS, Drizzle, zod, existing OpenRouter client (same pattern as representation enrichment), Postgres JSON metadata column, BullMQ for backfill.

**Master plan reference:** `docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md:464-541`.

---

## File Structure

- **Modify** `apps/api/src/document/document-vector.service.ts` — add `issuerName` / `tickers` into chunk metadata at ingestion.
- **Create** `apps/api/src/document/metadata-extractors/issuer-ticker-extractor.ts` — pure helper producing `{ issuerName?: string, tickers: string[] }` from `(originalFileName, docTitle, chunkText)`.
- **Create** `apps/api/scripts/rag-backfill-chunk-issuer-tickers.ts` — backfill CLI (idempotent, batched).
- **Create** `apps/api/src/rag/query-entity-extractor.service.ts` — regex-first + LLM-fallback extractor.
- **Modify** `apps/api/src/rag/metadata-pre-filter.service.ts` — soft vs hard filter decision.
- **Modify** `apps/api/src/rag/retrieval-orchestrator.service.ts` — forward entity hints into lane filters.
- **Modify** `apps/api/src/config/rag.config.ts` — new env vars and defaults.
- **Modify** `apps/api/src/rag/rag.module.ts` — register new provider.
- **Test** `apps/api/src/document/__tests__/metadata-extractors/issuer-ticker-extractor.spec.ts` (new).
- **Test** `apps/api/src/rag/__tests__/query-entity-extractor.service.spec.ts` (new).
- **Test** `apps/api/src/rag/__tests__/metadata-pre-filter.service.spec.ts` (extend — today's file is tiny, one passthrough test).
- **Test** `apps/api/src/rag/__tests__/retrieval-orchestrator.service.spec.ts` (extend — assert soft-filter pass-through into lanes).

---

## Task R4.0a: Write the failing issuer/ticker extractor test

**Files:**
- Create: `apps/api/src/document/metadata-extractors/issuer-ticker-extractor.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/document/metadata-extractors/issuer-ticker-extractor.spec.ts
import { extractIssuerAndTickers } from './issuer-ticker-extractor';

describe('extractIssuerAndTickers', () => {
  it('pulls ticker from 10-K filename like "AAPL_10K_2024.pdf"', () => {
    const result = extractIssuerAndTickers({
      originalFileName: 'AAPL_10K_2024.pdf',
      docTitle: null,
      chunkText: 'Apple Inc. reported revenue of $383B.',
    });
    expect(result.tickers).toContain('AAPL');
    expect(result.issuerName).toBe('Apple Inc.');
  });

  it('returns empty when no ticker-like token exists', () => {
    const result = extractIssuerAndTickers({
      originalFileName: 'general-news.txt',
      docTitle: null,
      chunkText: 'Markets opened lower today on inflation data.',
    });
    expect(result.tickers).toEqual([]);
    expect(result.issuerName).toBeUndefined();
  });

  it('de-dupes tickers found in multiple sources', () => {
    const result = extractIssuerAndTickers({
      originalFileName: 'TSLA_earnings.pdf',
      docTitle: 'Tesla Inc. Q3 2024 Earnings',
      chunkText: 'TSLA reported record deliveries this quarter.',
    });
    expect(result.tickers).toEqual(['TSLA']);
  });

  it('ignores 2-letter words that are not in the whitelist', () => {
    const result = extractIssuerAndTickers({
      originalFileName: 'research-note.md',
      docTitle: null,
      chunkText: 'We see CEO commentary as material.',
    });
    expect(result.tickers).toEqual([]); // CEO, SEE are not whitelisted tickers
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @finsentinel/api test -- issuer-ticker-extractor`
Expected: FAIL — file `issuer-ticker-extractor.ts` does not exist.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/api/src/document/metadata-extractors/issuer-ticker-extractor.spec.ts
git commit -m "test(rag): failing test for issuer/ticker extractor"
```

---

## Task R4.0b: Implement the extractor against the ticker whitelist

**Files:**
- Create: `apps/api/src/document/metadata-extractors/issuer-ticker-extractor.ts`

Reuse the R3 whitelist from `apps/api/src/rag/ticker-whitelist.ts`. That list was
vetted for the intent classifier and is the authoritative ticker set until the DB
`instruments` table lands (tracked in R3 file header).

- [ ] **Step 1: Implement against the whitelist**

```ts
// apps/api/src/document/metadata-extractors/issuer-ticker-extractor.ts
import { TICKER_WHITELIST } from '../../rag/ticker-whitelist';

export interface IssuerTickerInput {
  originalFileName: string | null;
  docTitle: string | null;
  chunkText: string;
}

export interface IssuerTickerResult {
  issuerName?: string;
  tickers: string[];
}

const ISSUER_REGEX = /\b([A-Z][a-zA-Z&.]+(?:\s+[A-Z][a-zA-Z&.]+)*\s+(?:Inc|Corp|Corporation|Company|Ltd|LLC|Holdings|Group|PLC)\.?)\b/;

const TOKEN_REGEX = /\b[A-Z]{2,5}\b/g;

export function extractIssuerAndTickers(input: IssuerTickerInput): IssuerTickerResult {
  const sources = [input.originalFileName ?? '', input.docTitle ?? '', input.chunkText];
  const found = new Set<string>();

  for (const src of sources) {
    const matches = src.match(TOKEN_REGEX) ?? [];
    for (const token of matches) {
      if (TICKER_WHITELIST.has(token)) {
        found.add(token);
      }
    }
  }

  let issuerName: string | undefined;
  for (const src of [input.docTitle ?? '', input.chunkText]) {
    const m = src.match(ISSUER_REGEX);
    if (m?.[1]) {
      issuerName = m[1];
      break;
    }
  }

  return {
    tickers: [...found].sort(),
    ...(issuerName ? { issuerName } : {}),
  };
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @finsentinel/api test -- issuer-ticker-extractor`
Expected: PASS, 4/4.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @finsentinel/api typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/document/metadata-extractors/issuer-ticker-extractor.ts
git commit -m "feat(rag): add issuer/ticker extractor reusing R3 whitelist"
```

---

## Task R4.0c: Wire the extractor into DocumentVectorService

**Files:**
- Modify: `apps/api/src/document/document-vector.service.ts:86-96` — metadata object construction.
- Test: `apps/api/src/document/__tests__/document-vector.service.spec.ts` (extend).

- [ ] **Step 1: Write a failing assertion that new fields land in metadata**

Append to the existing spec:

```ts
it('writes issuerName + tickers into chunk metadata when extractable', async () => {
  const text = 'Apple Inc. reported revenue of $383B. AAPL remains our top pick.';
  await service.vectorize('doc-id-1', text, {
    doc_type: 'RESEARCH',
    sector: 'Technology',
    region_id: 'US',
    source: 'AAPL_research.md',
    date: '2026-01-01',
  });

  const call = mockChunkStore.replaceChunks.mock.calls[0];
  const firstChunk = call[2][0];
  expect(firstChunk.metadata.tickers).toEqual(['AAPL']);
  expect(firstChunk.metadata.issuerName).toBe('Apple Inc.');
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @finsentinel/api test -- document-vector.service`
Expected: FAIL — `tickers` undefined.

- [ ] **Step 3: Wire the extractor**

In `document-vector.service.ts`, add the import and call the extractor once per
document (not per chunk — the issuer does not change chunk-to-chunk, only content
changes). Pass `originalFileName` down from `vectorize.consumer.ts` via a new
optional field on the `metadata` param.

First, widen the metadata param type at the call site in `vectorize.consumer.ts:120-126`:

```ts
const chunkCount = await this.vectorService.vectorize(docId, text, {
  doc_type: doc.docType,
  sector: doc.sector ?? '',
  region_id: 'US',
  source: doc.originalFileName,
  date: new Date().toISOString().split('T')[0]!,
  __originalFileName: doc.originalFileName,  // used by extractor, stripped before persist
});
```

Then in `document-vector.service.ts` around lines 51-97:

```ts
import { extractIssuerAndTickers } from './metadata-extractors/issuer-ticker-extractor';

// ... inside vectorize(), after structuredChunks is computed:
const { __originalFileName: originalFileName, ...persistedMetadata } = metadata as Record<string, string | undefined>;

const sampleText = structuredChunks.map((c) => c.text).slice(0, 3).join('\n');
const { issuerName, tickers } = extractIssuerAndTickers({
  originalFileName: originalFileName ?? persistedMetadata['source'] ?? null,
  docTitle: persistedMetadata['title'] ?? null,
  chunkText: sampleText,
});

// ... in the replaceChunks call, inside metadata:
metadata: {
  ...persistedMetadata,
  source_type: sourceType,
  source_id: docId,
  chunk_index: index,
  modality: chunk.modality,
  section_path: chunk.sectionPath.length > 0 ? chunk.sectionPath.join(' / ') : null,
  title: chunk.title ?? persistedMetadata['title'] ?? null,
  tickers,                          // always set — empty array if none found
  ...(issuerName ? { issuerName } : {}),
},
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @finsentinel/api test -- document-vector.service`
Expected: PASS.

- [ ] **Step 5: Run full rag + queue suites to confirm no regressions**

Run: `pnpm --filter @finsentinel/api test -- rag queue`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/document/document-vector.service.ts apps/api/src/queue/vectorize.consumer.ts apps/api/src/document/__tests__/document-vector.service.spec.ts
git commit -m "feat(rag): write issuerName and tickers into chunk metadata at ingestion (R4.0)"
```

---

## Task R4.0d: Backfill CLI for existing chunks

**Files:**
- Create: `apps/api/src/rag/admin/rag-backfill-chunk-issuer-tickers.cli.ts`.
- Create: `apps/api/src/rag/admin/__tests__/rag-backfill-chunk-issuer-tickers.cli.spec.ts`.

**Architectural decision (2026-04-20):** this CLI follows the standalone
NestFactory bootstrap pattern from `rag-backfill-representation-sparse.cli.ts`,
not nest-commander. The codebase does not use nest-commander for any rag:*
CLI, and the standalone pattern supports pure-helper exports that the
spec tests directly. The `apps/api/src/cli/rag.cli.module.ts` registration
step from an earlier draft is N/A — no shared CLI module exists.

- [ ] **Step 1: Inspect the existing sparse-backfill CLI**

Run: `pnpm --filter @finsentinel/api exec ls apps/api/scripts`
Expected: see `rag-backfill-sparse.ts` as the template.

- [ ] **Step 2: Implement the backfill command**

```ts
// apps/api/scripts/rag-backfill-chunk-issuer-tickers.ts
import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, documentChunks, documents, eq } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { extractIssuerAndTickers } from '../src/document/metadata-extractors/issuer-ticker-extractor';

interface Options {
  batch?: number;
  dryRun?: boolean;
  force?: boolean;
}

@Injectable()
@Command({
  name: 'rag:backfill:chunk-issuer-tickers',
  description: 'Populate tickers + issuerName on document_chunks.metadata for historical rows',
})
export class RagBackfillChunkIssuerTickersCommand extends CommandRunner {
  private readonly logger = new Logger(RagBackfillChunkIssuerTickersCommand.name);

  constructor(@Inject('DRIZZLE_DB') private readonly db: DrizzleDB) { super(); }

  async run(_: string[], options: Options): Promise<void> {
    const batch = options.batch ?? 500;
    const dryRun = options.dryRun ?? false;
    const force = options.force ?? false;

    let updated = 0;
    let scanned = 0;
    let cursor = '';

    while (true) {
      const rows = await this.db.execute<{
        id: string;
        source_id: string;
        metadata: Record<string, unknown>;
        content: string;
        original_file_name: string | null;
        doc_title: string | null;
      }>(sql`
        SELECT c.id, c.source_id, c.metadata, c.content,
               d.original_file_name,
               d.meta_title AS doc_title
        FROM document_chunks c
        LEFT JOIN documents d ON d.id::text = c.source_id
        WHERE c.id > ${cursor}
          ${force ? sql`` : sql`AND (c.metadata->>'tickers' IS NULL OR NOT (c.metadata ? 'tickers'))`}
        ORDER BY c.id
        LIMIT ${batch}
      `);

      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;
      scanned += rows.length;

      for (const row of rows) {
        const { issuerName, tickers } = extractIssuerAndTickers({
          originalFileName: row.original_file_name,
          docTitle: row.doc_title,
          chunkText: row.content.slice(0, 2000),
        });

        const newMetadata = {
          ...row.metadata,
          tickers,
          ...(issuerName ? { issuerName } : {}),
        };

        if (!dryRun) {
          await this.db.execute(sql`
            UPDATE document_chunks
            SET metadata = ${JSON.stringify(newMetadata)}::jsonb
            WHERE id = ${row.id}
          `);
        }
        updated++;
      }

      this.logger.log(`scanned=${scanned} updated=${updated} cursor=${cursor} dryRun=${dryRun}`);
    }

    this.logger.log(`backfill complete: scanned=${scanned} updated=${updated}`);
  }

  @Option({ flags: '--batch <n>', description: 'rows per batch' })
  parseBatch(v: string) { return Number(v); }
  @Option({ flags: '--dry-run', description: 'do not write' })
  parseDryRun() { return true; }
  @Option({ flags: '--force', description: 'overwrite even when already populated' })
  parseForce() { return true; }
}
```

- [ ] **Step 3: Register in the CLI module and test dry-run**

Add the command to `apps/api/src/cli/rag.cli.module.ts` providers.

Run: `pnpm --filter @finsentinel/api cli rag:backfill:chunk-issuer-tickers --dry-run --batch 50`
Expected: scans rows without writing; log line confirms `updated > 0` if the local DB has ingested docs.

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/rag-backfill-chunk-issuer-tickers.ts apps/api/src/cli/rag.cli.module.ts
git commit -m "feat(rag): backfill CLI for chunk issuer/ticker metadata (R4.0)"
```

---

## Task R4.1a: Write the failing QueryEntityExtractorService test (regex path)

**Files:**
- Create: `apps/api/src/rag/__tests__/query-entity-extractor.service.spec.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/rag/__tests__/query-entity-extractor.service.spec.ts
import { QueryEntityExtractorService } from '../query-entity-extractor.service';

describe('QueryEntityExtractorService (regex path)', () => {
  let service: QueryEntityExtractorService;

  beforeEach(() => {
    // No LLM fallback in this suite; pass null as the LLM client.
    service = new QueryEntityExtractorService({
      llmFallbackEnabled: false,
      llmClient: null,
      hardMinConfidence: 0.85,
      timeoutMs: 1500,
      concurrency: 4,
    });
  });

  it('extracts ticker from whitelisted all-caps token', async () => {
    const result = await service.extract('show me AAPL 10-K for 2024');
    expect(result.tickers).toEqual([{ value: 'AAPL', confidence: 0.95 }]);
    expect(result.docType).toEqual({ value: '10-K', confidence: 0.9 });
    expect(result.timeRange?.after).toBeInstanceOf(Date);
  });

  it('returns empty + fallbackFlag when no regex hits', async () => {
    const result = await service.extract('what is going on with the market');
    expect(result.tickers).toEqual([]);
    expect(result.docType).toBeUndefined();
    expect(result.fallbackFlag).toBeUndefined(); // LLM fallback disabled -> no flag
  });

  it('rejects 2-letter all-caps tokens that are not in the whitelist', async () => {
    const result = await service.extract('CEO commentary on IT spend');
    expect(result.tickers).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @finsentinel/api test -- query-entity-extractor`
Expected: FAIL — file missing.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/rag/__tests__/query-entity-extractor.service.spec.ts
git commit -m "test(rag): failing tests for QueryEntityExtractorService regex path"
```

---

## Task R4.1b: Implement regex path of QueryEntityExtractorService

**Files:**
- Create: `apps/api/src/rag/query-entity-extractor.service.ts`.

- [ ] **Step 1: Implement regex extraction (LLM path is stubbed out in the next task)**

```ts
// apps/api/src/rag/query-entity-extractor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { TICKER_WHITELIST } from './ticker-whitelist';

export interface EntityHit<T> { value: T; confidence: number; }

export interface ExtractedEntities {
  tickers: EntityHit<string>[];
  issuerNames: EntityHit<string>[];
  docType?: EntityHit<'10-K' | '10-Q' | '8-K' | 'news' | 'research' | 'filing' | 'other'>;
  timeRange?: { after?: Date; before?: Date; confidence: number };
  sectors: EntityHit<string>[];
  regions: EntityHit<string>[];
  fallbackFlag?: 'llm_empty' | 'llm_error' | 'llm_timeout' | 'llm_circuit_open' | 'llm_disabled';
}

export interface QueryEntityExtractorConfig {
  llmFallbackEnabled: boolean;
  llmClient: unknown | null;    // typed properly in R4.1c
  hardMinConfidence: number;    // unused here; consumed by metadata-pre-filter.service.ts
  timeoutMs: number;
  concurrency: number;
}

const TOKEN_RE = /\b[A-Z]{2,5}\b/g;
const FY_RE = /\bFY(\d{4})\b/i;
const Q_RE = /\bQ([1-4])\s*20(\d{2})\b/i;
const YEAR_RE = /\b(20\d{2})\b/;
const DOC_TYPE_RE = /\b(10-K|10-Q|8-K|annual report|quarterly report)\b/i;

@Injectable()
export class QueryEntityExtractorService {
  private readonly logger = new Logger(QueryEntityExtractorService.name);

  constructor(private readonly config: QueryEntityExtractorConfig) {}

  async extract(query: string): Promise<ExtractedEntities> {
    const regexHits = this.regexPass(query);
    const hasAnyHit =
      regexHits.tickers.length > 0 ||
      regexHits.issuerNames.length > 0 ||
      regexHits.docType !== undefined ||
      regexHits.timeRange !== undefined;

    if (hasAnyHit || !this.config.llmFallbackEnabled) {
      if (!hasAnyHit && !this.config.llmFallbackEnabled) {
        return { ...regexHits, fallbackFlag: 'llm_disabled' };
      }
      return regexHits;
    }

    // LLM fallback path is wired in Task R4.1c.
    return { ...regexHits, fallbackFlag: 'llm_disabled' };
  }

  private regexPass(query: string): ExtractedEntities {
    const tickers: EntityHit<string>[] = [];
    const seen = new Set<string>();
    for (const token of query.match(TOKEN_RE) ?? []) {
      if (TICKER_WHITELIST.has(token) && !seen.has(token)) {
        tickers.push({ value: token, confidence: 0.95 });
        seen.add(token);
      }
    }

    let docType: ExtractedEntities['docType'];
    const dt = query.match(DOC_TYPE_RE);
    if (dt?.[1]) {
      const normalised = dt[1].toLowerCase().startsWith('annual')
        ? '10-K' : dt[1].toLowerCase().startsWith('quarterly') ? '10-Q' : dt[1].toUpperCase() as '10-K' | '10-Q' | '8-K';
      docType = { value: normalised, confidence: 0.9 };
    }

    let timeRange: ExtractedEntities['timeRange'];
    const fy = query.match(FY_RE);
    const qy = query.match(Q_RE);
    const yr = query.match(YEAR_RE);
    if (fy?.[1]) {
      const y = Number(fy[1]);
      timeRange = { after: new Date(Date.UTC(y, 0, 1)), before: new Date(Date.UTC(y, 11, 31)), confidence: 0.95 };
    } else if (qy?.[1] && qy[2]) {
      const q = Number(qy[1]); const y = 2000 + Number(qy[2]);
      const start = new Date(Date.UTC(y, (q - 1) * 3, 1));
      const end = new Date(Date.UTC(y, q * 3, 0));
      timeRange = { after: start, before: end, confidence: 0.9 };
    } else if (yr?.[1]) {
      const y = Number(yr[1]);
      timeRange = { after: new Date(Date.UTC(y, 0, 1)), before: new Date(Date.UTC(y, 11, 31)), confidence: 0.85 };
    }

    return { tickers, issuerNames: [], sectors: [], regions: [], docType, timeRange };
  }
}
```

- [ ] **Step 2: Run the regex-path test**

Run: `pnpm --filter @finsentinel/api test -- query-entity-extractor`
Expected: PASS 3/3.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/rag/query-entity-extractor.service.ts
git commit -m "feat(rag): QueryEntityExtractorService regex path (R4.1)"
```

---

## Task R4.1c: Wire LLM fallback with concurrency + circuit breaker

**Files:**
- Modify: `apps/api/src/rag/query-entity-extractor.service.ts` — add LLM branch.
- Test: `apps/api/src/rag/__tests__/query-entity-extractor.service.spec.ts` — extend.

- [ ] **Step 1: Add the failing LLM-path test**

```ts
describe('QueryEntityExtractorService (LLM fallback)', () => {
  it('invokes LLM when regex is empty and flag is on', async () => {
    const llm = { complete: jest.fn().mockResolvedValue(
      JSON.stringify({
        tickers: [], issuerNames: [{ value: 'Nvidia', confidence: 0.9 }],
        sectors: [{ value: 'Semiconductors', confidence: 0.85 }],
        regions: [], docType: null, timeRange: null,
      }),
    ) };
    const service = new QueryEntityExtractorService({
      llmFallbackEnabled: true, llmClient: llm,
      hardMinConfidence: 0.85, timeoutMs: 1500, concurrency: 4,
    });

    const result = await service.extract('the chip supplier story');
    expect(result.issuerNames).toEqual([{ value: 'Nvidia', confidence: 0.9 }]);
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after 3 consecutive failures', async () => {
    const llm = { complete: jest.fn().mockRejectedValue(new Error('429')) };
    const service = new QueryEntityExtractorService({
      llmFallbackEnabled: true, llmClient: llm,
      hardMinConfidence: 0.85, timeoutMs: 1500, concurrency: 4,
    });

    for (let i = 0; i < 3; i++) await service.extract('some query without tickers');
    const guarded = await service.extract('another query');
    expect(guarded.fallbackFlag).toBe('llm_circuit_open');
    expect(llm.complete).toHaveBeenCalledTimes(3); // 4th call short-circuits
  });

  it('falls back to regex output on LLM timeout', async () => {
    const llm = { complete: () => new Promise(() => {}) }; // never resolves
    const service = new QueryEntityExtractorService({
      llmFallbackEnabled: true, llmClient: llm,
      hardMinConfidence: 0.85, timeoutMs: 50, concurrency: 4,
    });

    const result = await service.extract('plain query');
    expect(result.fallbackFlag).toBe('llm_timeout');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @finsentinel/api test -- query-entity-extractor`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Implement LLM fallback with guardrails**

In `query-entity-extractor.service.ts`, replace the stub section with:

```ts
import { z } from 'zod';

const LlmResponseSchema = z.object({
  tickers: z.array(z.object({ value: z.string(), confidence: z.number().min(0).max(1) })),
  issuerNames: z.array(z.object({ value: z.string(), confidence: z.number().min(0).max(1) })),
  sectors: z.array(z.object({ value: z.string(), confidence: z.number().min(0).max(1) })),
  regions: z.array(z.object({ value: z.string(), confidence: z.number().min(0).max(1) })),
  docType: z.object({ value: z.string(), confidence: z.number().min(0).max(1) }).nullable(),
  timeRange: z.object({
    after: z.string().nullable().optional(),
    before: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1),
  }).nullable(),
});

interface LlmClientLike { complete(prompt: string): Promise<string>; }

export class QueryEntityExtractorService {
  // ...existing...
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private inflight = 0;

  async extract(query: string): Promise<ExtractedEntities> {
    const regexHits = this.regexPass(query);
    const hasAnyHit =
      regexHits.tickers.length > 0 ||
      regexHits.docType !== undefined ||
      regexHits.timeRange !== undefined;

    if (hasAnyHit) return regexHits;
    if (!this.config.llmFallbackEnabled) return { ...regexHits, fallbackFlag: 'llm_disabled' };
    if (Date.now() < this.circuitOpenUntil) return { ...regexHits, fallbackFlag: 'llm_circuit_open' };
    if (this.inflight >= this.config.concurrency) return { ...regexHits, fallbackFlag: 'llm_circuit_open' };

    this.inflight++;
    try {
      const llm = this.config.llmClient as LlmClientLike | null;
      if (!llm) return { ...regexHits, fallbackFlag: 'llm_disabled' };
      const timer = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), this.config.timeoutMs),
      );
      const raw = await Promise.race([llm.complete(this.buildPrompt(query)), timer]);
      const parsed = LlmResponseSchema.safeParse(JSON.parse(raw));
      this.consecutiveFailures = 0;
      if (!parsed.success) return { ...regexHits, fallbackFlag: 'llm_empty' };
      return this.mergeLlm(regexHits, parsed.data);
    } catch (err) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3) {
        this.circuitOpenUntil = Date.now() + 30_000;
        this.logger.warn(`query entity LLM circuit open for 30s after ${this.consecutiveFailures} failures`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { ...regexHits, fallbackFlag: msg === 'timeout' ? 'llm_timeout' : 'llm_error' };
    } finally {
      this.inflight--;
    }
  }

  private buildPrompt(query: string): string {
    return `Extract entities from this query. Respond as JSON matching this schema: ${JSON.stringify(Object.keys(LlmResponseSchema.shape))}. Query: ${query}`;
  }

  private mergeLlm(regex: ExtractedEntities, llm: z.infer<typeof LlmResponseSchema>): ExtractedEntities {
    return {
      ...regex,
      issuerNames: llm.issuerNames,
      sectors: llm.sectors,
      regions: llm.regions,
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @finsentinel/api test -- query-entity-extractor`
Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/rag/query-entity-extractor.service.ts apps/api/src/rag/__tests__/query-entity-extractor.service.spec.ts
git commit -m "feat(rag): LLM fallback path with concurrency + circuit breaker (R4.1)"
```

---

## Task R4.2: Soft vs hard filter decision in MetadataPreFilterService

**Files:**
- Modify: `apps/api/src/rag/metadata-pre-filter.service.ts`.
- Test: `apps/api/src/rag/__tests__/metadata-pre-filter.service.spec.ts` (extend).

- [ ] **Step 1: Write failing tests**

```ts
// apps/api/src/rag/__tests__/metadata-pre-filter.service.spec.ts
import { MetadataPreFilterService, PreFilterMode } from '../metadata-pre-filter.service';

describe('MetadataPreFilterService.buildFilter (soft/hard)', () => {
  const explicit = { docType: 'SEC_FILING' };

  it('mode=off returns hardFilter=explicit only', () => {
    const s = new MetadataPreFilterService({ mode: 'off', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('AAPL 10-K', 'exact_lookup', explicit, {
      tickers: [{ value: 'AAPL', confidence: 0.95 }],
      issuerNames: [], sectors: [], regions: [],
    } as any);
    expect(r.hardFilter).toEqual(explicit);
    expect(r.softFilter).toBeUndefined();
  });

  it('mode=hard promotes all extracted to hard filter', () => {
    const s = new MetadataPreFilterService({ mode: 'hard', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('AAPL 10-K', 'exact_lookup', explicit, {
      tickers: [{ value: 'AAPL', confidence: 0.95 }],
      issuerNames: [], sectors: [], regions: [],
    } as any);
    expect(r.hardFilter).toMatchObject({ ...explicit, tickers: ['AAPL'] });
  });

  it('mode=soft with low-confidence extraction keeps them in softFilter', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('chip maker', 'colloquial', explicit, {
      tickers: [], issuerNames: [{ value: 'Nvidia', confidence: 0.7 }],
      sectors: [], regions: [],
    } as any);
    expect(r.hardFilter).toEqual(explicit);
    expect(r.softFilter?.issuerName).toEqual(['Nvidia']);
  });

  it('mode=soft promotes high-confidence extraction to hard filter', () => {
    const s = new MetadataPreFilterService({ mode: 'soft', hardMinConfidence: 0.85, minCandidatesByClass: {} });
    const r = s.buildFilter('AAPL 10-K', 'exact_lookup', explicit, {
      tickers: [{ value: 'AAPL', confidence: 0.95 }],
      issuerNames: [], sectors: [], regions: [],
    } as any);
    expect(r.hardFilter).toMatchObject({ tickers: ['AAPL'] });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @finsentinel/api test -- metadata-pre-filter`
Expected: FAIL — `PreFilterMode`, constructor config shape not present.

- [ ] **Step 3: Implement**

Replace `metadata-pre-filter.service.ts` with:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { QueryClass } from './retrieval-planner.service';
import type { SparseSearchFilters } from './sparse-search.service';
import type { ExtractedEntities } from './query-entity-extractor.service';

export type PreFilterMode = 'off' | 'soft' | 'hard';

export interface PreFilterConfig {
  mode: PreFilterMode;
  hardMinConfidence: number;
  minCandidatesByClass: Partial<Record<QueryClass, number>>;
}

export interface PreFilter {
  hardFilter: SparseSearchFilters & { tickers?: string[]; issuerName?: string[] };
  softFilter?: SparseSearchFilters & { tickers?: string[]; issuerName?: string[] };
  candidateDocIds: string[];
  appliedMode: PreFilterMode;
}

@Injectable()
export class MetadataPreFilterService {
  private readonly logger = new Logger(MetadataPreFilterService.name);

  constructor(private readonly config: PreFilterConfig) {}

  buildFilter(
    _query: string,
    _queryClass: QueryClass | undefined,
    explicitFilters: SparseSearchFilters,
    extracted: ExtractedEntities | null,
  ): PreFilter {
    if (this.config.mode === 'off' || !extracted) {
      return { hardFilter: { ...explicitFilters }, candidateDocIds: [], appliedMode: 'off' };
    }

    const highConfidenceTickers = extracted.tickers.filter(t => t.confidence >= this.config.hardMinConfidence).map(t => t.value);
    const highConfidenceIssuers = extracted.issuerNames.filter(t => t.confidence >= this.config.hardMinConfidence).map(t => t.value);
    const lowConfidenceIssuers = extracted.issuerNames.filter(t => t.confidence < this.config.hardMinConfidence).map(t => t.value);

    if (this.config.mode === 'hard') {
      return {
        hardFilter: {
          ...explicitFilters,
          ...(highConfidenceTickers.length ? { tickers: highConfidenceTickers } : {}),
          ...(highConfidenceIssuers.length ? { issuerName: highConfidenceIssuers } : {}),
        },
        candidateDocIds: [],
        appliedMode: 'hard',
      };
    }

    return {
      hardFilter: {
        ...explicitFilters,
        ...(highConfidenceTickers.length ? { tickers: highConfidenceTickers } : {}),
        ...(highConfidenceIssuers.length ? { issuerName: highConfidenceIssuers } : {}),
      },
      softFilter: lowConfidenceIssuers.length
        ? { ...(lowConfidenceIssuers.length ? { issuerName: lowConfidenceIssuers } : {}) }
        : undefined,
      candidateDocIds: [],
      appliedMode: 'soft',
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @finsentinel/api test -- metadata-pre-filter`
Expected: PASS 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/rag/metadata-pre-filter.service.ts apps/api/src/rag/__tests__/metadata-pre-filter.service.spec.ts
git commit -m "feat(rag): MetadataPreFilterService soft/hard decision with confidence threshold (R4.2)"
```

---

## Task R4.3: Integrate into the orchestrator + sparse/dense lane SQL

**Files:**
- Modify: `apps/api/src/rag/retrieval-orchestrator.service.ts:55-78`.
- Modify: `apps/api/src/rag/sparse-search.service.ts` — extend `SparseSearchFilters` with optional `tickers?: string[]` / `issuerName?: string[]` and add a `WHERE metadata @> ...` clause when set.
- Test: `apps/api/src/rag/__tests__/retrieval-orchestrator.service.spec.ts` (extend).

- [ ] **Step 1: Extend `SparseSearchFilters`**

Edit `apps/api/src/rag/sparse-search.service.ts`:

```ts
export interface SparseSearchFilters {
  docType?: string;
  sector?: string;
  regionId?: string;
  afterDate?: string;
  tickers?: string[];
  issuerName?: string[];
}
```

In the SQL builder (search for existing `WHERE` construction in the same file), add:

```ts
if (filters.tickers?.length) {
  where.push(sql`metadata->'tickers' ?| ${filters.tickers}::text[]`);
}
if (filters.issuerName?.length) {
  where.push(sql`metadata->>'issuerName' = ANY(${filters.issuerName})`);
}
```

- [ ] **Step 2: Wire extractor + soft/hard decision into orchestrator**

In `retrieval-orchestrator.service.ts:55-78`, replace the current call to `metadataPreFilter.buildFilter(...)` with an async flow:

```ts
// (at class top, after existing constructor)
constructor(
  // ...existing deps...
  private readonly queryEntityExtractor: QueryEntityExtractorService,   // NEW
) {}

// inside orchestrate():
const extracted = await this.queryEntityExtractor.extract(rewrittenQuery);
const preFilter = this.metadataPreFilter.buildFilter(
  rewrittenQuery, request.queryClass, filters, extracted,
);

const { candidateDocIds: _unusedInV1, appliedMode: _appliedMode, softFilter: _soft, ...rest } = preFilter;
const effectiveFilters = rest.hardFilter;

// ...existing lane fan-out using effectiveFilters...
```

Emit a trace field:

```ts
this.logger.debug(
  `metadata prefilter applied: mode=${preFilter.appliedMode} tickers=${JSON.stringify(effectiveFilters.tickers ?? [])} issuerName=${JSON.stringify(effectiveFilters.issuerName ?? [])}`,
);
```

- [ ] **Step 3: Extend the orchestrator spec to assert hints flow through**

Append to `retrieval-orchestrator.service.spec.ts`:

```ts
it('passes extracted ticker hint into sparse lane WHERE filter', async () => {
  const extractor = { extract: jest.fn().mockResolvedValue({
    tickers: [{ value: 'AAPL', confidence: 0.95 }],
    issuerNames: [], sectors: [], regions: [],
  })};
  const preFilter = { buildFilter: jest.fn().mockReturnValue({
    hardFilter: { docType: 'SEC_FILING', tickers: ['AAPL'] },
    candidateDocIds: [], appliedMode: 'soft',
  })};
  const sparse = { search: jest.fn().mockResolvedValue([]) };
  // ...build orchestrator with stubs, call orchestrate({...})
  // Assert sparse.search receives filters.tickers === ['AAPL']
  expect(sparse.search.mock.calls[0][0].filters.tickers).toEqual(['AAPL']);
});
```

- [ ] **Step 4: Run the full rag suite**

Run: `pnpm --filter @finsentinel/api test -- rag`
Expected: all green (323 + new cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/rag/retrieval-orchestrator.service.ts apps/api/src/rag/sparse-search.service.ts apps/api/src/rag/__tests__/retrieval-orchestrator.service.spec.ts
git commit -m "feat(rag): wire query entity extractor into orchestrator and lane filters (R4.3)"
```

---

## Task R4.4: Config wiring + module registration

**Files:**
- Modify: `apps/api/src/config/rag.config.ts`.
- Modify: `apps/api/src/rag/rag.module.ts`.

- [ ] **Step 1: Add env vars with defaults**

Append to `ragConfig` export:

```ts
metadataPrefilter: {
  mode: (process.env['RAG_METADATA_PREFILTER_MODE'] ?? 'soft') as 'off' | 'soft' | 'hard',
  hardMinConfidence: Number(process.env['RAG_METADATA_HARD_FILTER_MIN_CONFIDENCE']) || 0.85,
  llmFallbackEnabled: process.env['RAG_METADATA_LLM_FALLBACK_ENABLED'] === 'true',
  llmTimeoutMs: Number(process.env['RAG_METADATA_LLM_TIMEOUT_MS']) || 1500,
  llmConcurrency: Number(process.env['RAG_METADATA_LLM_CONCURRENCY']) || 4,
  minCandidatesByClass: JSON.parse(
    process.env['RAG_METADATA_MIN_CANDIDATES_BY_CLASS'] ??
    '{"exact_lookup":5,"colloquial":20,"analytical":30,"multi_part":30,"relational":20,"factoid":15}',
  ) as Record<string, number>,
},
```

- [ ] **Step 2: Register `QueryEntityExtractorService` as a provider**

In `apps/api/src/rag/rag.module.ts`, add:

```ts
{
  provide: QueryEntityExtractorService,
  useFactory: (config: ConfigService, openrouter: OpenRouterClient /* or the existing provider */) => {
    return new QueryEntityExtractorService({
      llmFallbackEnabled: config.get<boolean>('rag.metadataPrefilter.llmFallbackEnabled', false),
      llmClient: openrouter, // must expose complete(prompt: string): Promise<string>
      hardMinConfidence: config.get<number>('rag.metadataPrefilter.hardMinConfidence', 0.85),
      timeoutMs: config.get<number>('rag.metadataPrefilter.llmTimeoutMs', 1500),
      concurrency: config.get<number>('rag.metadataPrefilter.llmConcurrency', 4),
    });
  },
  inject: [ConfigService, OpenRouterClient],
},
{
  provide: MetadataPreFilterService,
  useFactory: (config: ConfigService) => new MetadataPreFilterService({
    mode: config.get('rag.metadataPrefilter.mode', 'soft'),
    hardMinConfidence: config.get('rag.metadataPrefilter.hardMinConfidence', 0.85),
    minCandidatesByClass: config.get('rag.metadataPrefilter.minCandidatesByClass', {}),
  }),
  inject: [ConfigService],
},
```

Adjust the existing registration for `MetadataPreFilterService` — previously no-arg — to use this factory.

- [ ] **Step 3: Typecheck + full test run**

Run these in parallel:
- `pnpm --filter @finsentinel/api typecheck`
- `pnpm --filter @finsentinel/api test -- rag`
- `pnpm --filter @finsentinel/api test -- document`

Expected: all clean / all green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/config/rag.config.ts apps/api/src/rag/rag.module.ts
git commit -m "feat(rag): config + DI wiring for R4 metadata soft routing"
```

---

## Task R4.5: Over-filter guardrail (minimum candidates per class)

**Files:**
- Modify: `apps/api/src/rag/retrieval-orchestrator.service.ts` — post-lane candidate count check.
- Test: `apps/api/src/rag/__tests__/retrieval-orchestrator.service.spec.ts`.

- [ ] **Step 1: Write failing test**

```ts
it('downgrades hard filter to soft when candidate count < min-by-class threshold', async () => {
  // Stub sparse/dense to each return 2 candidates under hard filter (below colloquial.min=20)
  // Stub re-run without hard filter to return 30 candidates
  // Assert orchestrator records fallbackFlag: 'prefilter_downgraded' and returns 30 candidates
});
```

- [ ] **Step 2: Implement the guardrail**

After the initial lane fan-out completes, count fused candidates. If smaller than the class threshold:

```ts
const threshold = this.config.minCandidatesByClass[request.queryClass ?? 'colloquial'] ?? 0;
if (fusedCandidates.length < threshold && preFilter.hardFilter.tickers?.length) {
  this.logger.warn(`prefilter downgraded: class=${request.queryClass} candidates=${fusedCandidates.length} threshold=${threshold}`);
  // Re-run with explicit filter only (drop ticker/issuer hints)
  const relaxedFilters = { ...filters };
  // ...second fan-out; record fallbackFlag on the trace...
}
```

Emit a Prometheus counter: `rag_metadata_prefilter_downgrade_total{class}`.

- [ ] **Step 3: Test + commit**

Run: `pnpm --filter @finsentinel/api test -- retrieval-orchestrator`
Expected: the new case PASSES; all existing cases PASS.

```bash
git add apps/api/src/rag/retrieval-orchestrator.service.ts apps/api/src/rag/__tests__/retrieval-orchestrator.service.spec.ts
git commit -m "feat(rag): min-candidates guardrail downgrades hard filter to soft (R4.5)"
```

---

## Task R4.6: Eval-gate verification

- [ ] **Step 1: Run the CI eval gate against the seeded fixture**

Run:

```bash
pnpm --filter @finsentinel/api cli rag:eval:run --config services/evaluation-runner/configs/ci-offline.yaml
```

Expected: no regression vs baseline in `reports/wave2-baseline-offline.json`.
`exact_lookup` bucket may not move offline (CorpusRetriever bypasses metadata
filters). That's expected; live-API eval will produce the real delta.

- [ ] **Step 2: Record the numbers in the master plan's Progress Log**

Append a dated entry to `docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md` under `## Progress Log`.

- [ ] **Step 3: Commit**

```bash
git add docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md
git commit -m "docs(plan): record R4 landing in Wave 2 progress log"
```

---

## Exit Criteria

- `MetadataPreFilterService` is no longer a passthrough.
- `document_chunks.metadata` carries `tickers` (always) and `issuerName` (when extractable) on newly ingested and backfilled rows.
- All tests pass: `pnpm --filter @finsentinel/api test -- rag document queue`.
- Typecheck is clean.
- Flag-off regression snapshot unchanged.
- Offline eval gate green.
- Plan Progress Log updated.

## Risks

- **R4.0 backfill on a large DB:** batch CLI loops but never commits across rows in a single statement. On a prod DB with millions of chunks the first run could take hours. Document in the runbook: run during off-peak window or add `--limit` flag if needed.
- **LLM fallback cost explosion:** this is why R4.1 ships with `RAG_METADATA_LLM_FALLBACK_ENABLED=false` as the default. Staging proves cost is acceptable before prod flips it.
- **R4.5 second-pass latency:** when the downgrade fires, orchestrator runs retrieval twice. Emit the counter so Grafana can show how often this happens; if >5% of traffic, tune `hardMinConfidence` up or the `minCandidatesByClass` down.
