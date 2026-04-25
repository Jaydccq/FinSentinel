/**
 * Token-vs-char chunking benchmark — R6.1 gate.
 *
 * Run with:
 *   pnpm --filter @finsentinel/api exec tsx apps/api/test/bench/chunking-unit-benchmark.ts
 *
 * Compares:
 *   (a) Char-based splitting via DocumentChunkingService.chunk() — the current production path.
 *   (b) Naive token-based splitting via a cheap heuristic (no tiktoken dependency):
 *       ~4 chars/token for ASCII/EN, ~1.5 chars/token for CJK.
 *
 * The point of R6.1 is to produce ENOUGH evidence to choose a default unit for Wave 2
 * doc-type-aware chunking, not to build a production-grade tokenizer.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { DocumentChunkingService } from '../../src/document/document-chunking.service';

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

function detectLang(text: string): 'en' | 'cjk' {
  return /[\u4e00-\u9fff\u3040-\u309f\uac00-\ud7af]/.test(text) ? 'cjk' : 'en';
}

// ---------------------------------------------------------------------------
// Cheap heuristic token counter (no tiktoken)
//   EN/ASCII: ~4 chars per token  (BPE average for typical prose)
//   CJK:      ~1.5 chars per token (most CJK characters are single tokens)
// ---------------------------------------------------------------------------

function approxTokenCount(text: string, lang: 'en' | 'cjk'): number {
  return lang === 'cjk' ? Math.ceil(text.length / 1.5) : Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Naive token-based splitter
//   Splits on paragraph boundaries, merging paragraphs until the approx token
//   count of the accumulated buffer exceeds maxTokens, then flushes.
// ---------------------------------------------------------------------------

function splitByTokens(text: string, lang: 'en' | 'cjk', maxTokens = 480): string[] {
  const paragraphs = text.split(/\n\n+/);
  const out: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const candidate = current ? `${current}\n\n${trimmed}` : trimmed;
    if (approxTokenCount(candidate, lang) <= maxTokens) {
      current = candidate;
    } else {
      if (current) out.push(current);
      // If a single paragraph exceeds the limit, include it as-is.
      current = trimmed;
    }
  }
  if (current) out.push(current);
  return out;
}

// ---------------------------------------------------------------------------
// percentile helper
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.ceil((p / 100) * sorted.length) - 1, sorted.length - 1);
  return sorted[idx];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const fixtureDir = join(__dirname, '../fixtures/chunking-corpus');
  if (!existsSync(fixtureDir)) {
    console.error(`Fixture directory not found: ${fixtureDir}`);
    process.exit(1);
  }

  // Build DocumentChunkingService with default production config.
  const configService = new ConfigService({
    rag: {
      chunking: {
        chunkSize: 500,
        chunkOverlap: 50,
        minChunkSizeChars: 200,
        maxNumChunks: 10000,
      },
    },
  });
  const charChunker = new DocumentChunkingService(configService);

  const MAX_TOKENS = 480;

  type Row = {
    file: string;
    lang: string;
    chars: number;
    charChunks: number;
    charMeanLen: number;
    charMeanTokens: number;
    charP95Tokens: number;
    tokenChunks: number;
    tokenMeanTokens: number;
    tokenP95Tokens: number;
    charWallMs: number;
    tokenWallMs: number;
  };

  const results: Row[] = [];

  for (const f of readdirSync(fixtureDir).sort()) {
    const text = readFileSync(join(fixtureDir, f), 'utf-8');
    const lang = detectLang(text);

    // --- Char branch ---
    const t0 = performance.now();
    const charChunks = charChunker.chunk(text);
    const charWallMs = Math.round((performance.now() - t0) * 100) / 100;

    const charTokenCounts = charChunks.map((c) => approxTokenCount(c, lang)).sort((a, b) => a - b);
    const charMeanLen = charChunks.length
      ? Math.round(charChunks.reduce((a, c) => a + c.length, 0) / charChunks.length)
      : 0;
    const charMeanTokens = charTokenCounts.length
      ? Math.round(charTokenCounts.reduce((a, v) => a + v, 0) / charTokenCounts.length)
      : 0;
    const charP95Tokens = percentile(charTokenCounts, 95);

    // --- Token branch ---
    const t1 = performance.now();
    const tokChunks = splitByTokens(text, lang, MAX_TOKENS);
    const tokenWallMs = Math.round((performance.now() - t1) * 100) / 100;

    const tokTokenCounts = tokChunks.map((c) => approxTokenCount(c, lang)).sort((a, b) => a - b);
    const tokenMeanTokens = tokTokenCounts.length
      ? Math.round(tokTokenCounts.reduce((a, v) => a + v, 0) / tokTokenCounts.length)
      : 0;
    const tokenP95Tokens = percentile(tokTokenCounts, 95);

    results.push({
      file: f,
      lang,
      chars: text.length,
      charChunks: charChunks.length,
      charMeanLen,
      charMeanTokens,
      charP95Tokens,
      tokenChunks: tokChunks.length,
      tokenMeanTokens,
      tokenP95Tokens,
      charWallMs,
      tokenWallMs,
    });
  }

  console.log('\n=== Char-vs-Token Chunking Benchmark (R6.1) ===\n');
  console.table(results);

  const summary = {
    maxTokens: MAX_TOKENS,
    totalFiles: results.length,
    langDistribution: results.reduce(
      (acc, r) => ({ ...acc, [r.lang]: (acc[r.lang] ?? 0) + 1 }),
      {} as Record<string, number>,
    ),
    charBranch: {
      totalChunks: results.reduce((a, r) => a + r.charChunks, 0),
      totalWallMs: Math.round(results.reduce((a, r) => a + r.charWallMs, 0) * 100) / 100,
      overallMeanTokens: Math.round(
        results.reduce((a, r) => a + r.charMeanTokens * r.charChunks, 0) /
          Math.max(
            results.reduce((a, r) => a + r.charChunks, 0),
            1,
          ),
      ),
      maxP95Tokens: Math.max(...results.map((r) => r.charP95Tokens)),
    },
    tokenBranch: {
      totalChunks: results.reduce((a, r) => a + r.tokenChunks, 0),
      totalWallMs: Math.round(results.reduce((a, r) => a + r.tokenWallMs, 0) * 100) / 100,
      overallMeanTokens: Math.round(
        results.reduce((a, r) => a + r.tokenMeanTokens * r.tokenChunks, 0) /
          Math.max(
            results.reduce((a, r) => a + r.tokenChunks, 0),
            1,
          ),
      ),
      maxP95Tokens: Math.max(...results.map((r) => r.tokenP95Tokens)),
    },
    embeddingProviderLimit: 8192,
    charBranchExceedsLimit: results.some((r) => r.charP95Tokens > 8192),
    tokenBranchExceedsLimit: results.some((r) => r.tokenP95Tokens > 8192),
  };

  console.log(JSON.stringify({ summary }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
