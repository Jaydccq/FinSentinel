# R6 — Doc-Type-Aware Chunking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single character-based chunker with three doc-type-aware chunkers (report, Q&A, table) dispatched by a classifier, so table rows stay intact with their headers, Q&A pairs stay together, and reports respect section boundaries.

**Architecture:** `DocumentChunkingService.chunkStructured()` gains a dispatch layer that routes to one of four chunkers based on a heuristic classifier operating on `StructuredDocument` signals (heading density, table density, question-line density). The default chunker stays as the fallback. A reindex CLI replays existing documents through the new chunkers with a **drain-and-wait** checkpoint — after `replaceChunks` deletes the old chunks, the representation enrichment queue must fully drain before the eval gate runs, otherwise recall shows a false regression.

**Tech Stack:** NestJS, Drizzle, BullMQ (for queue drain detection), existing `MarkdownStructureService`, `tiktoken` or similar if R6.1 decides on tokens.

**Master plan reference:** `docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md:632-727`.

**Dependency:** R5 ships the heading spine metadata onto `StructuredDocument` (or leaves R6 to wire it — per R5.6 in the R5 plan, this is R6's job).

---

## File Structure

- **Create** `apps/api/test/bench/chunking-unit-benchmark.ts` — the token-vs-char benchmark required by R6.1.
- **Create** `apps/api/src/document/chunkers/doc-type-classifier.ts` — heuristic classifier.
- **Create** `apps/api/src/document/chunkers/report-chunker.ts`.
- **Create** `apps/api/src/document/chunkers/qa-chunker.ts`.
- **Create** `apps/api/src/document/chunkers/table-chunker.ts`.
- **Create** `apps/api/src/document/chunkers/default-chunker.ts` — extracts the current `chunkStructured` logic so the dispatcher becomes a pure switch.
- **Modify** `apps/api/src/document/document-chunking.service.ts:89-149` — replace with dispatcher.
- **Modify** `apps/api/src/config/rag.config.ts` — per-doc-type chunk size config.
- **Modify** `apps/api/src/document/markdown-structure.service.ts` — thread R5's heading spine (if R5 deferred) into the output.
- **Create** `apps/api/scripts/rag-reindex-by-doctype.ts` — reindex CLI with drain+wait.
- **Test** `apps/api/src/document/__tests__/chunkers/doc-type-classifier.spec.ts`.
- **Test** `apps/api/src/document/__tests__/chunkers/report-chunker.spec.ts`.
- **Test** `apps/api/src/document/__tests__/chunkers/qa-chunker.spec.ts`.
- **Test** `apps/api/src/document/__tests__/chunkers/table-chunker.spec.ts`.
- **Test** `apps/api/src/document/__tests__/document-chunking.service.spec.ts` (extend).

---

## Task R6.1: Token-vs-char benchmark — evidence before code

This is a **gate**: no chunker implementation until the benchmark runs and the Key Decisions section of the master plan records the outcome.

**Files:**
- Create: `apps/api/test/bench/chunking-unit-benchmark.ts`.

- [ ] **Step 1: Implement the benchmark**

```ts
// apps/api/test/bench/chunking-unit-benchmark.ts
// Run with: pnpm --filter @finsentinel/api exec tsx apps/api/test/bench/chunking-unit-benchmark.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DocumentChunkingService } from '../../src/document/document-chunking.service';
// ... set up the service with default config, loop over a fixture corpus,
// split by chars vs by tokens, and record:
// - per-chunk token count mean, p95
// - any chunk exceeding the embedding provider's max input (e.g. 8192 tokens)
// - wall-clock for each approach
// - corpus breakdown: English financial reports vs CJK news

async function main() {
  const fixtureDir = join(__dirname, '../fixtures/chunking-corpus');
  const files = readdirSync(fixtureDir);
  const results: Array<{ file: string; lang: 'en' | 'cjk'; chars: number; tokens: number; p95Tokens: number; wallChar: number; wallToken: number }> = [];

  for (const f of files) {
    const text = readFileSync(join(fixtureDir, f), 'utf-8');
    const lang: 'en' | 'cjk' = /[\u4e00-\u9fff\u3040-\u309f\uac00-\ud7af]/.test(text) ? 'cjk' : 'en';
    // char approach
    const t0 = Date.now();
    // ...split using current DocumentChunkingService.chunk()
    const wallChar = Date.now() - t0;
    // token approach
    const t1 = Date.now();
    // ...lazy-import tiktoken encode, split on token boundaries at 480 tokens
    const wallToken = Date.now() - t1;
    results.push({ file: f, lang, chars: text.length, tokens: 0, p95Tokens: 0, wallChar, wallToken });
  }

  console.table(results);
  console.log(JSON.stringify({ summary: /* aggregate */ {} }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Collect a fixture corpus**

Drop 20 real docs into `apps/api/test/fixtures/chunking-corpus/`: 10 English 10-Ks or research notes, 10 CJK news items. Use existing test fixtures if available; otherwise sample 20 docs from a staging DB via the existing export path.

- [ ] **Step 3: Run and record**

```bash
pnpm --filter @finsentinel/api exec tsx apps/api/test/bench/chunking-unit-benchmark.ts > benchmarks/2026-04-20-chunking-unit.txt
```

- [ ] **Step 4: Record the decision**

Append to `docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md` `## Key Decisions`:

```md
- **2026-04-20 R6.1 chunk unit:** tokens | chars, chosen because: [evidence from benchmark]. Default size: [N]. Benchmark artifact: benchmarks/2026-04-20-chunking-unit.txt.
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/bench/chunking-unit-benchmark.ts apps/api/test/fixtures/chunking-corpus/ benchmarks/ docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md
git commit -m "bench(rag): token-vs-char chunking benchmark + R6.1 decision"
```

**Do not start R6.2 until the decision is recorded.**

---

## Task R6.2a: Write failing report-chunker test

**Files:**
- Create: `apps/api/src/document/__tests__/chunkers/report-chunker.spec.ts`.

- [ ] **Step 1: Write the test**

```ts
import { ReportChunker } from '../../chunkers/report-chunker';
import type { StructuredDocument } from '../../structured-document';

describe('ReportChunker', () => {
  const chunker = new ReportChunker({ chunkSize: 500, chunkOverlap: 50, minChunkSizeChars: 100, maxNumChunks: 10000 });

  it('emits one chunk per heading section when sections are small', () => {
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [
        { text: 'Overview of operations.', modality: 'text', title: 'Item 1. Business', sectionPath: ['Item 1. Business'], parentId: null, pageStart: null, pageEnd: null },
        { text: 'Risk factors include regulation.', modality: 'text', title: 'Item 1A. Risk Factors', sectionPath: ['Item 1A. Risk Factors'], parentId: null, pageStart: null, pageEnd: null },
      ],
    };
    const out = chunker.chunk(doc);
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe('Item 1. Business');
    expect(out[1].title).toBe('Item 1A. Risk Factors');
  });

  it('splits a long section on sentence boundaries and preserves sectionPath on splits', () => {
    const longText = Array.from({ length: 10 }, (_, i) => `Sentence ${i + 1} about Apple. `).join('') + Array.from({ length: 10 }, (_, i) => `More detail ${i + 1}. `).join('');
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [
        { text: longText, modality: 'text', title: 'Long section', sectionPath: ['Long section'], parentId: null, pageStart: null, pageEnd: null },
      ],
    };
    const out = chunker.chunk(doc);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.sectionPath).toEqual(['Long section']);
  });

  it('preserves table chunks as-is (delegates to table chunker)', () => {
    const doc: StructuredDocument = {
      sourceFormat: 'markdown',
      chunks: [
        { text: '| h1 | h2 |\n|----|----|\n| a | b |', modality: 'table', title: null, sectionPath: ['Financials'], parentId: null, pageStart: null, pageEnd: null },
      ],
    };
    const out = chunker.chunk(doc);
    expect(out).toHaveLength(1);
    expect(out[0].modality).toBe('table');
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `pnpm --filter @finsentinel/api test -- report-chunker`
Expected: FAIL — file missing.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/api/src/document/__tests__/chunkers/report-chunker.spec.ts
git commit -m "test(rag): failing tests for ReportChunker"
```

---

## Task R6.2b: Implement `ReportChunker`

**Files:**
- Create: `apps/api/src/document/chunkers/report-chunker.ts`.

- [ ] **Step 1: Implement**

```ts
// apps/api/src/document/chunkers/report-chunker.ts
import type { StructuredChunk, StructuredDocument } from '../structured-document';

export interface ReportChunkerConfig {
  chunkSize: number;
  chunkOverlap: number;
  minChunkSizeChars: number;
  maxNumChunks: number;
}

export class ReportChunker {
  constructor(private readonly config: ReportChunkerConfig) {}

  chunk(doc: StructuredDocument): StructuredChunk[] {
    const output: StructuredChunk[] = [];
    for (const input of doc.chunks) {
      if (input.modality !== 'text') {
        output.push(input);
        continue;
      }
      if (!input.text || input.text.trim().length === 0) continue;

      if (input.text.length <= this.config.chunkSize) {
        if (input.text.trim().length >= this.config.minChunkSizeChars) output.push(input);
      } else {
        const parts = this.splitAtSentence(input.text, this.config.chunkSize);
        for (const part of parts) {
          if (part.trim().length >= this.config.minChunkSizeChars) {
            output.push({
              ...input,
              text: part,
              parentId: null,
            });
          }
        }
      }

      if (output.length >= this.config.maxNumChunks) return output.slice(0, this.config.maxNumChunks);
    }
    return output;
  }

  private splitAtSentence(text: string, maxLen: number): string[] {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const result: string[] = [];
    let current = '';
    for (const s of sentences) {
      const candidate = current ? `${current} ${s}` : s;
      if (candidate.length <= maxLen) {
        current = candidate;
      } else {
        if (current) result.push(current);
        current = s;
      }
    }
    if (current) result.push(current);
    return result;
  }
}
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @finsentinel/api test -- report-chunker`
Expected: PASS 3/3.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/document/chunkers/report-chunker.ts
git commit -m "feat(rag): ReportChunker — section-aware semantic chunking (R6.2)"
```

---

## Task R6.3: Q&A chunker (TDD loop)

**Files:**
- Create: `apps/api/src/document/chunkers/qa-chunker.ts`.
- Create: `apps/api/src/document/__tests__/chunkers/qa-chunker.spec.ts`.

- [ ] **Step 1: Failing test**

```ts
import { QaChunker } from '../../chunkers/qa-chunker';

describe('QaChunker', () => {
  const chunker = new QaChunker({ chunkSize: 800 });

  it('pairs question and answer into a single chunk', () => {
    const doc = {
      sourceFormat: 'markdown' as const,
      chunks: [
        { text: 'Q: What is the dividend policy?\nA: The board reviews dividends quarterly.\n\nQ: When is the next review?\nA: Next review is in Q2 2026.', modality: 'text' as const, title: 'FAQ', sectionPath: ['FAQ'], parentId: null, pageStart: null, pageEnd: null },
      ],
    };
    const out = chunker.chunk(doc);
    expect(out).toHaveLength(2);
    expect(out[0].text).toContain('dividend policy');
    expect(out[0].text).toContain('reviews dividends quarterly');
  });

  it('handles "Question:" / "Answer:" prefixes', () => {
    const doc = {
      sourceFormat: 'markdown' as const,
      chunks: [
        { text: 'Question: Who owns the firm?\nAnswer: Public shareholders.', modality: 'text' as const, title: null, sectionPath: [], parentId: null, pageStart: null, pageEnd: null },
      ],
    };
    const out = chunker.chunk(doc);
    expect(out).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to fail**

Run: `pnpm --filter @finsentinel/api test -- qa-chunker`
Expected: FAIL — file missing.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/document/chunkers/qa-chunker.ts
import type { StructuredChunk, StructuredDocument } from '../structured-document';

const QUESTION_RE = /^(?:Q\s*[:.]?|Question\s*[:.]?|#{1,3}\s*Q\d+)\s*/i;
const ANSWER_RE = /^(?:A\s*[:.]?|Answer\s*[:.]?)\s*/i;

export class QaChunker {
  constructor(private readonly config: { chunkSize: number }) {}

  chunk(doc: StructuredDocument): StructuredChunk[] {
    const output: StructuredChunk[] = [];
    for (const input of doc.chunks) {
      if (input.modality !== 'text') { output.push(input); continue; }
      const pairs = this.findQaPairs(input.text);
      for (const pair of pairs) {
        output.push({
          text: pair,
          title: input.title,
          sectionPath: input.sectionPath,
          parentId: null,
          modality: 'text',
          pageStart: input.pageStart,
          pageEnd: input.pageEnd,
        });
      }
    }
    return output;
  }

  private findQaPairs(text: string): string[] {
    const lines = text.split(/\n+/);
    const pairs: string[] = [];
    let current: string[] = [];
    let state: 'idle' | 'in-q' | 'in-a' = 'idle';

    for (const line of lines) {
      if (QUESTION_RE.test(line)) {
        if (current.length) pairs.push(current.join('\n'));
        current = [line];
        state = 'in-q';
      } else if (ANSWER_RE.test(line) || state === 'in-q') {
        current.push(line);
        state = 'in-a';
      } else if (state === 'in-a') {
        current.push(line);
      }
    }
    if (current.length) pairs.push(current.join('\n'));
    return pairs.filter(p => p.length >= 20);
  }
}
```

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter @finsentinel/api test -- qa-chunker`
Expected: PASS.

```bash
git add apps/api/src/document/chunkers/qa-chunker.ts apps/api/src/document/__tests__/chunkers/qa-chunker.spec.ts
git commit -m "feat(rag): QaChunker pairs Q/A into single chunks (R6.3)"
```

---

## Task R6.4: Table chunker (TDD loop)

**Files:**
- Create: `apps/api/src/document/chunkers/table-chunker.ts`.
- Create: `apps/api/src/document/__tests__/chunkers/table-chunker.spec.ts`.

- [ ] **Step 1: Failing test — header preservation on row-wise split**

```ts
import { TableChunker } from '../../chunkers/table-chunker';

describe('TableChunker', () => {
  it('keeps small table as a single chunk', () => {
    const chunker = new TableChunker({ chunkSize: 500 });
    const small = '| h1 | h2 |\n|----|----|\n| a | b |';
    const out = chunker.chunk({
      sourceFormat: 'markdown', chunks: [
        { text: small, modality: 'table', title: 'Revenue', sectionPath: ['Financials'], parentId: null, pageStart: null, pageEnd: null },
      ],
    } as any);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('| h1 | h2 |');
  });

  it('splits a large table row-wise with header on every split', () => {
    const chunker = new TableChunker({ chunkSize: 120 });
    const rows = Array.from({ length: 20 }, (_, i) => `| r${i} | v${i} |`).join('\n');
    const big = `| h1 | h2 |\n|----|----|\n${rows}`;
    const out = chunker.chunk({
      sourceFormat: 'markdown', chunks: [
        { text: big, modality: 'table', title: 'Big', sectionPath: ['Financials'], parentId: null, pageStart: null, pageEnd: null },
      ],
    } as any);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.text).toMatch(/^\| h1 \| h2 \|/m);
  });
});
```

- [ ] **Step 2: Run to fail**

Run: `pnpm --filter @finsentinel/api test -- table-chunker`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/document/chunkers/table-chunker.ts
import type { StructuredChunk, StructuredDocument } from '../structured-document';

export class TableChunker {
  constructor(private readonly config: { chunkSize: number }) {}

  chunk(doc: StructuredDocument): StructuredChunk[] {
    const output: StructuredChunk[] = [];
    for (const input of doc.chunks) {
      if (input.modality !== 'table') { output.push(input); continue; }

      const [header, separator, ...rows] = input.text.split(/\n/);
      if (!header || !separator || rows.length === 0 || input.text.length <= this.config.chunkSize) {
        output.push(input);
        continue;
      }

      const headerBlock = `${header}\n${separator}`;
      let current: string[] = [];
      let currentLen = headerBlock.length;

      const flush = () => {
        if (current.length === 0) return;
        output.push({
          text: `${headerBlock}\n${current.join('\n')}`,
          title: input.title,
          sectionPath: input.sectionPath,
          parentId: null,
          modality: 'table',
          pageStart: input.pageStart,
          pageEnd: input.pageEnd,
        });
        current = [];
        currentLen = headerBlock.length;
      };

      for (const row of rows) {
        if (currentLen + row.length + 1 > this.config.chunkSize) flush();
        current.push(row);
        currentLen += row.length + 1;
      }
      flush();
    }
    return output;
  }
}
```

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter @finsentinel/api test -- table-chunker`
Expected: PASS.

```bash
git add apps/api/src/document/chunkers/table-chunker.ts apps/api/src/document/__tests__/chunkers/table-chunker.spec.ts
git commit -m "feat(rag): TableChunker keeps header row on every split (R6.4)"
```

---

## Task R6.5: Doc-type classifier + dispatch

**Files:**
- Create: `apps/api/src/document/chunkers/doc-type-classifier.ts`.
- Create: `apps/api/src/document/__tests__/chunkers/doc-type-classifier.spec.ts`.
- Modify: `apps/api/src/document/document-chunking.service.ts:89-149` — replace with dispatcher.

- [ ] **Step 1: Failing classifier tests**

```ts
import { classifyDocType } from '../../chunkers/doc-type-classifier';

describe('classifyDocType', () => {
  it('flags table_heavy when tables make up >=40% of chunks', () => {
    const tableChunks = Array.from({ length: 6 }, () => ({ modality: 'table' }));
    const textChunks = Array.from({ length: 4 }, () => ({ modality: 'text' }));
    expect(classifyDocType({ chunks: [...tableChunks, ...textChunks] } as any)).toBe('table_heavy');
  });

  it('flags qa when questions make up >=20% of lines', () => {
    const doc = { chunks: [{ modality: 'text', text: 'Q: a?\nA: b.\nQ: c?\nA: d.\nOther.\nOther.' }] };
    expect(classifyDocType(doc as any)).toBe('qa');
  });

  it('flags report when heading density >=3 distinct h2/h3', () => {
    const doc = { chunks: [
      { modality: 'text', title: 'Item 1', sectionPath: ['Item 1'], text: 'x' },
      { modality: 'text', title: 'Item 1A', sectionPath: ['Item 1A'], text: 'x' },
      { modality: 'text', title: 'Item 2', sectionPath: ['Item 2'], text: 'x' },
      { modality: 'text', title: 'Item 3', sectionPath: ['Item 3'], text: 'x' },
    ]};
    expect(classifyDocType(doc as any)).toBe('report');
  });

  it('falls back to default otherwise', () => {
    const doc = { chunks: [{ modality: 'text', title: null, sectionPath: [], text: 'plain article text.' }] };
    expect(classifyDocType(doc as any)).toBe('default');
  });
});
```

- [ ] **Step 2: Implement the classifier**

```ts
// apps/api/src/document/chunkers/doc-type-classifier.ts
import type { StructuredDocument } from '../structured-document';

export type ClassifiedDocType = 'report' | 'qa' | 'table_heavy' | 'default';

const QUESTION_LINE_RE = /(^|\n)(?:Q\s*[:.]?|Question\s*[:.]?)\s*/i;

export function classifyDocType(doc: StructuredDocument): ClassifiedDocType {
  const total = doc.chunks.length || 1;
  const tables = doc.chunks.filter(c => c.modality === 'table').length;
  if (tables / total >= 0.4) return 'table_heavy';

  const textBlob = doc.chunks.filter(c => c.modality === 'text').map(c => c.text).join('\n');
  const lines = textBlob.split(/\n+/).filter(l => l.trim().length > 0);
  const questions = lines.filter(l => QUESTION_LINE_RE.test(l)).length;
  if (lines.length > 0 && questions / lines.length >= 0.2) return 'qa';

  const distinctSections = new Set<string>();
  for (const c of doc.chunks) {
    if (c.sectionPath.length > 0) distinctSections.add(c.sectionPath.join(' / '));
  }
  if (distinctSections.size >= 3) return 'report';

  return 'default';
}
```

- [ ] **Step 3: Refactor `DocumentChunkingService` to dispatch**

Extract the existing `chunkStructured` body into `DefaultChunker` (mechanical move) and replace the service body with:

```ts
constructor(
  @Inject(ConfigService) configService: ConfigService,
  private readonly reportChunker: ReportChunker,
  private readonly qaChunker: QaChunker,
  private readonly tableChunker: TableChunker,
  private readonly defaultChunker: DefaultChunker,
) { /* ...existing config parse... */ }

chunkStructured(doc: StructuredDocument): StructuredChunk[] {
  const docType = classifyDocType(doc);
  switch (docType) {
    case 'report':      return this.reportChunker.chunk(doc);
    case 'qa':          return this.qaChunker.chunk(doc);
    case 'table_heavy': return this.tableChunker.chunk(doc);
    default:            return this.defaultChunker.chunk(doc);
  }
}
```

- [ ] **Step 4: Run the full document suite**

Run these in parallel:
- `pnpm --filter @finsentinel/api typecheck`
- `pnpm --filter @finsentinel/api test -- document`
- `pnpm --filter @finsentinel/api test -- rag`

Expected: all green. If the existing `document-chunking.service.spec.ts` asserted specific char-based behaviour, update it to target `DefaultChunker` instead.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/document/chunkers/ apps/api/src/document/document-chunking.service.ts apps/api/src/document/__tests__/chunkers/ apps/api/src/document/__tests__/document-chunking.service.spec.ts
git commit -m "feat(rag): doc-type classifier + chunker dispatch (R6.5)"
```

---

## Task R6.6: Reindex CLI with drain+wait checkpoint

**Files:**
- Create: `apps/api/scripts/rag-reindex-by-doctype.ts`.
- Register in `apps/api/src/cli/rag.cli.module.ts`.

- [ ] **Step 1: Implement**

```ts
// apps/api/scripts/rag-reindex-by-doctype.ts
import { Command, CommandRunner, Option } from 'nest-commander';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, documents, eq } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { Queue } from 'bullmq';
import { REPRESENTATION_ENRICH_QUEUE } from '../src/queue/queue.constants';
import { DocumentVectorService } from '../src/document/document-vector.service';
import { HybridStorageService } from '../src/storage/hybrid.storage';
import { DocumentParseService } from '../src/document/document-parse.service';

const CHUNKER_VERSION = 'v2-doctype';

interface Options {
  batch?: number; dryRun?: boolean; force?: boolean; maxWaitSeconds?: number;
}

@Injectable()
@Command({
  name: 'rag:reindex:by-doctype',
  description: 'Re-chunk existing documents with doc-type-aware chunkers, with drain+wait checkpoint.',
})
export class RagReindexByDocTypeCommand extends CommandRunner {
  private readonly logger = new Logger(RagReindexByDocTypeCommand.name);
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    @Inject('BULLMQ_CONNECTION') private readonly connection: any,
    private readonly vectorService: DocumentVectorService,
    private readonly storage: HybridStorageService,
    private readonly parseService: DocumentParseService,
  ) { super(); }

  async run(_: string[], opts: Options): Promise<void> {
    const batch = opts.batch ?? 25;
    const dryRun = opts.dryRun ?? false;
    const force = opts.force ?? false;
    const maxWait = opts.maxWaitSeconds ?? 1800;
    let skipped = 0, reindexed = 0;

    const queue = new Queue(REPRESENTATION_ENRICH_QUEUE, { connection: this.connection });

    const rows = await this.db.execute<{ id: string; chunker_version: string | null }>(sql`
      SELECT id, (meta->>'chunker_version') AS chunker_version FROM documents
      WHERE status = 'VECTORIZED'
      ORDER BY id
    `);

    for (let i = 0; i < rows.length; i += batch) {
      const slice = rows.slice(i, i + batch);
      for (const row of slice) {
        if (!force && row.chunker_version === CHUNKER_VERSION) { skipped++; continue; }
        if (dryRun) { reindexed++; continue; }

        const [doc] = await this.db
          .select({
            id: documents.id,
            storageKey: documents.storageKey,
            docType: documents.docType,
            sector: documents.sector,
            originalFileName: documents.originalFileName,
          })
          .from(documents)
          .where(eq(documents.id, row.id))
          .limit(1);
        if (!doc?.storageKey) continue;

        const bytes = await this.storage.download(doc.storageKey);
        const mime = this.guessMimeType(doc.originalFileName);
        const text = this.parseService.parseToCleanText(bytes, mime);
        if (!text) continue;

        await this.vectorService.vectorize(row.id, text, {
          doc_type: doc.docType,
          sector: doc.sector ?? '',
          region_id: 'US',
          source: doc.originalFileName,
          date: new Date().toISOString().slice(0, 10),
        });

        await this.db.execute(sql`
          UPDATE documents
          SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{chunker_version}', to_jsonb(${CHUNKER_VERSION}::text))
          WHERE id = ${row.id}
        `);
        reindexed++;
      }
      this.logger.log(`batch ${i / batch + 1}: reindexed=${reindexed} skipped=${skipped}`);
      if (!dryRun) await this.drainWait(queue, maxWait);
    }

    this.logger.log(`done: reindexed=${reindexed} skipped=${skipped} dryRun=${dryRun}`);
    await queue.close();
  }

  private guessMimeType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
      html: 'text/html', htm: 'text/html', xml: 'text/xml',
      json: 'application/json', pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    return map[ext] ?? 'text/plain';
  }

  private async drainWait(queue: Queue, maxWaitSeconds: number): Promise<void> {
    const deadline = Date.now() + maxWaitSeconds * 1000;
    const stabilityWindowMs = 30_000;
    let stableSince: number | null = null;
    while (Date.now() < deadline) {
      const [waiting, active] = await Promise.all([queue.getWaitingCount(), queue.getActiveCount()]);
      if (waiting === 0 && active === 0) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= stabilityWindowMs) return;
      } else {
        stableSince = null;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    this.logger.warn(`drain wait timed out after ${maxWaitSeconds}s; representation enrichment may still be catching up`);
  }

  @Option({ flags: '--batch <n>' }) parseBatch(v: string) { return Number(v); }
  @Option({ flags: '--dry-run' }) parseDryRun() { return true; }
  @Option({ flags: '--force' }) parseForce() { return true; }
  @Option({ flags: '--max-wait-seconds <n>' }) parseMaxWait(v: string) { return Number(v); }
}
```

- [ ] **Step 2: Smoke test dry-run**

Run: `pnpm --filter @finsentinel/api cli rag:reindex:by-doctype --dry-run --batch 5`
Expected: scans docs without writing; logs counts.

- [ ] **Step 3: Commit**

```bash
git add apps/api/scripts/rag-reindex-by-doctype.ts apps/api/src/cli/rag.cli.module.ts
git commit -m "feat(rag): rag:reindex:by-doctype CLI with drain+wait checkpoint (R6.6)"
```

---

## Task R6.7: Eval gate verification

- [ ] **Step 1: Run the eval gate**

Run:

```bash
pnpm --filter @finsentinel/api cli rag:eval:run --config services/evaluation-runner/configs/ci-offline.yaml
```

- [ ] **Step 2: Document the bucket deltas**

Record per-bucket recall@5 and recall@10 in `docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md`:

- `table_numeric` should move up materially (the table chunker is the biggest win).
- `long_doc` should move up too (section-aware splits prevent cross-section bleed).
- `exact_lookup` unchanged or better.

If offline CI can't show the delta (because `CorpusRetriever` bypasses chunkers — check the R2.6/R3.6 caveat), note that bucket delta verification waits on live-API CI.

- [ ] **Step 3: Commit**

```bash
git add docs/exec-plans/2026-04-19-rag-wave2-production-rollout-plan.md
git commit -m "docs(plan): record R6 landing + eval deltas in Wave 2 progress log"
```

---

## Exit Criteria

- Three chunker variants exist (`ReportChunker`, `QaChunker`, `TableChunker`) plus the refactored `DefaultChunker`.
- `DocumentChunkingService.chunkStructured` is a pure dispatch over `classifyDocType(doc)`.
- Reindex CLI exists and is idempotent (idempotency via `documents.meta->>'chunker_version'`).
- CLI blocks on representation enrichment queue drain before exiting success.
- Typecheck + rag + document tests green.
- Grafana panel plan for per-doc-type chunk count and size distribution added to the runbook (no code needed; dashboard JSON lives in ops repo).
- Flag-off regression snapshot unchanged.

## Risks

- **Reindex on large corpus.** The CLI loops in batches; on a prod DB with many GB of docs, a full reindex may take hours. Runbook must advise running during off-peak and monitoring the BullMQ queue backlog.
- **Drain-wait timeout masks slow enrichment.** If the representation enrichment worker is under-provisioned, the CLI's `--max-wait-seconds` default of 1800s may expire. The code emits a structured warning; operators must decide whether to re-run or wait longer.
- **Classifier heuristic misses edge cases.** The 40% / 20% / 3-section thresholds are guesses. Add a Prometheus counter `rag_chunker_dispatch_total{doc_type}` so staging data informs tuning.
- **R6.1 benchmark dependency.** This plan assumes R6.1 has recorded the char-vs-token decision before R6.2 starts. If the decision is "tokens", add a tokenizer adapter task; the default chunker's overlap math must move from chars to tokens. Treat that as a follow-up task list after R6.1's decision.
