import { randomUUID } from 'node:crypto';
import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { z } from 'zod';
import {
  documentChunks,
  documentChunkRepresentations,
  eq,
  and,
  sql,
} from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { aiConfig } from '../config/ai.config';
import { RagEmbeddingService } from './rag-embedding.service';
import { MetricsService } from '../common/services/metrics.service';
import type { LlmTextClient } from './eval/golden-candidates.service';
import { buildRepresentationTsvector } from './chunk-representation.tsvector';

// ── Public constants ───────────────────────────────────────────────────────────

/**
 * Bump this string whenever the enrichment prompts or representation schema
 * changes. Existing rows at lower versions are kept; the idempotency check
 * skips chunks that already have rows at CURRENT_REPRESENTATION_VERSION.
 */
export const CURRENT_REPRESENTATION_VERSION = 'rep-v1.0';

/** Injection token for the LLM text client used by this service. */
export const REPRESENTATION_LLM_CLIENT = 'REPRESENTATION_LLM_CLIENT';

/** Exported constant for T2.C backfill reuse. */
export const RAG_REPRESENTATION_BATCH_SIZE_DEFAULT = 50;

// ── LLM prompt ─────────────────────────────────────────────────────────────────

const ENRICHMENT_SYSTEM_PROMPT =
  'You annotate a document chunk for retrieval. Given the chunk text plus optional title and section path, produce a JSON object with these fields:\n' +
  '- contextual: a paragraph that prepends 40-80 words of doc/section context to the chunk text (Anthropic\'s Contextual Retrieval pattern)\n' +
  '- sample_questions: an array of 1 to 3 concise questions (12-18 words each) that this chunk can directly answer\n' +
  '- summary: one sentence summarizing this chunk (under 25 words)\n' +
  '- keywords: 3 to 8 short keyword or entity tokens that should appear in a lexical search\n\n' +
  'Return ONLY valid JSON, no prose, no code fences. Schema:\n' +
  '{"contextual": string, "sample_questions": string[], "summary": string, "keywords": string[]}';

// ── Zod schema for LLM response ────────────────────────────────────────────────

const enrichmentResponseSchema = z.object({
  contextual: z.string().min(1),
  sample_questions: z.array(z.string().min(1)).min(1).max(3),
  summary: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(3).max(8),
});

type EnrichmentResponse = z.infer<typeof enrichmentResponseSchema>;

// ── Error types ────────────────────────────────────────────────────────────────

export class ChunkNotFoundError extends Error {
  constructor(chunkId: string) {
    super(`chunk not found: ${chunkId}`);
    this.name = 'ChunkNotFoundError';
  }
}

// ── Public types ───────────────────────────────────────────────────────────────

export interface EnrichChunkResult {
  chunkId: string;
  status: 'succeeded' | 'skipped' | 'failed';
  representationsWritten: number;
  reason?: string;
}

// ── Circuit breaker state (in-process singleton per service instance) ──────────

interface CircuitBreakerState {
  consecutiveErrors: number;
  trippedUntil: number;
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class ChunkRepresentationService {
  private readonly logger = new Logger(ChunkRepresentationService.name);

  private readonly cb: CircuitBreakerState = {
    consecutiveErrors: 0,
    trippedUntil: 0,
  };

  private static readonly CB_THRESHOLD = 5;

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    @Inject(REPRESENTATION_LLM_CLIENT) private readonly llm: LlmTextClient,
    private readonly embeddingService: RagEmbeddingService,
    private readonly metrics: MetricsService,
    @Inject(aiConfig.KEY) private readonly _aiCfg: ConfigType<typeof aiConfig>,
    private readonly _configService: ConfigService,
  ) {}

  getCurrentVersion(): string {
    return CURRENT_REPRESENTATION_VERSION;
  }

  async enrichChunk(chunkId: string): Promise<EnrichChunkResult> {
    const start = Date.now();

    try {
      const result = await this.doEnrichChunk(chunkId);
      const latencyMs = Date.now() - start;

      this.metrics.observeHistogram(
        'rag_representation_enrich_latency_ms',
        'Latency in ms for chunk representation enrichment',
        {},
        latencyMs,
        [50, 100, 250, 500, 1000, 2500, 5000, 10000],
      );
      this.metrics.incrementCounter(
        'rag_representation_enrich_total',
        'Total chunk representation enrichment attempts',
        { status: result.status },
      );

      return result;
    } catch (err) {
      const latencyMs = Date.now() - start;
      this.metrics.observeHistogram(
        'rag_representation_enrich_latency_ms',
        'Latency in ms for chunk representation enrichment',
        {},
        latencyMs,
        [50, 100, 250, 500, 1000, 2500, 5000, 10000],
      );
      this.metrics.incrementCounter(
        'rag_representation_enrich_total',
        'Total chunk representation enrichment attempts',
        { status: 'failed' },
      );
      throw err;
    }
  }

  async enrichChunksBatch(chunkIds: string[]): Promise<EnrichChunkResult[]> {
    const results: EnrichChunkResult[] = [];
    for (const chunkId of chunkIds) {
      results.push(await this.enrichChunk(chunkId));
    }
    return results;
  }

  // ── Private implementation ─────────────────────────────────────────────────

  private async doEnrichChunk(chunkId: string): Promise<EnrichChunkResult> {
    // 1. Load chunk
    const [chunk] = await this.db
      .select({
        id: documentChunks.id,
        content: documentChunks.content,
        enrichmentStatus: documentChunks.enrichmentStatus,
        metaTitle: documentChunks.metaTitle,
        sectionPath: documentChunks.sectionPath,
      })
      .from(documentChunks)
      .where(eq(documentChunks.id, chunkId))
      .limit(1);

    if (!chunk) {
      throw new ChunkNotFoundError(chunkId);
    }

    // 2. Idempotency check — skip if already enriched at current version
    const existingRows = await this.db
      .select({ id: documentChunkRepresentations.id })
      .from(documentChunkRepresentations)
      .where(
        and(
          eq(documentChunkRepresentations.chunkId, chunkId),
          sql`${documentChunkRepresentations.metadata}->>'index_version' = ${CURRENT_REPRESENTATION_VERSION}`,
        ),
      )
      .limit(1);

    if (existingRows.length > 0) {
      return { chunkId, status: 'skipped', representationsWritten: 0, reason: 'already enriched at current version' };
    }

    // 3. Mark in_progress
    await this.db
      .update(documentChunks)
      .set({ enrichmentStatus: 'in_progress' })
      .where(eq(documentChunks.id, chunkId));

    // 4. Call LLM (with one retry on parse failure)
    let parsed: EnrichmentResponse;
    try {
      parsed = await this.callLlmWithRetry(chunk.content, chunk.metaTitle, chunk.sectionPath);
    } catch (err) {
      await this.db
        .update(documentChunks)
        .set({ enrichmentStatus: 'failed' })
        .where(eq(documentChunks.id, chunkId));
      return { chunkId, status: 'failed', representationsWritten: 0, reason: String(err) };
    }

    // 5. Embed contextual_text and joined sample_questions
    let contextualEmbedding: number[];
    let sampleQuestionEmbedding: number[];
    try {
      const joinedQuestions = parsed.sample_questions.join(' ');
      // TODO: Alternative — max-pool per-question embeddings (spec T2.B section "Embedding").
      // Joined string is cheaper (single API call) and sufficient for v1.
      [contextualEmbedding, sampleQuestionEmbedding] = await Promise.all([
        this.embeddingService.embedQuery(parsed.contextual),
        this.embeddingService.embedQuery(joinedQuestions),
      ]);
    } catch (err) {
      // Embedding failure after successful LLM: delete any partial rows, mark failed
      await this.db
        .delete(documentChunkRepresentations)
        .where(
          and(
            eq(documentChunkRepresentations.chunkId, chunkId),
            sql`${documentChunkRepresentations.metadata}->>'index_version' = ${CURRENT_REPRESENTATION_VERSION}`,
          ),
        );
      await this.db
        .update(documentChunks)
        .set({ enrichmentStatus: 'failed' })
        .where(eq(documentChunks.id, chunkId));
      return { chunkId, status: 'failed', representationsWritten: 0, reason: `embedding failed: ${err}` };
    }

    // 6. INSERT four representation rows (every column, per postgres.js mixed-default INSERT rule)
    const now = new Date();
    const versionMeta: Record<string, unknown> = { index_version: CURRENT_REPRESENTATION_VERSION };

    const keywordContent = parsed.keywords.join(', ');
    const summaryContent = parsed.summary;
    const sampleQuestionContent = parsed.sample_questions.join(' ');

    // Shared tsvector inputs — title/sectionPath/chunkContent come from the parent
    // chunk, representationContent is the per-row payload. Each call returns a
    // parameterised Drizzle sql`` fragment; never sql.raw with user text.
    const tsvectorBase = {
      title: chunk.metaTitle,
      sectionPath: chunk.sectionPath,
      chunkContent: chunk.content,
    };

    try {
      await this.db.insert(documentChunkRepresentations).values([
        {
          id: randomUUID(),
          chunkId,
          representationType: 'contextual_text',
          content: parsed.contextual,
          embedding: contextualEmbedding,
          searchVector: buildRepresentationTsvector('contextual_text', {
            ...tsvectorBase,
            representationContent: parsed.contextual,
          }),
          weight: 1.0,
          metadata: versionMeta,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: randomUUID(),
          chunkId,
          representationType: 'sample_question',
          content: sampleQuestionContent,
          embedding: sampleQuestionEmbedding,
          searchVector: buildRepresentationTsvector('sample_question', {
            ...tsvectorBase,
            representationContent: sampleQuestionContent,
          }),
          weight: 1.0,
          metadata: versionMeta,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: randomUUID(),
          chunkId,
          representationType: 'summary',
          content: summaryContent,
          embedding: null,
          searchVector: buildRepresentationTsvector('summary', {
            ...tsvectorBase,
            representationContent: summaryContent,
          }),
          weight: 0.8,
          metadata: versionMeta,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: randomUUID(),
          chunkId,
          representationType: 'keyword_entity',
          content: keywordContent,
          embedding: null,
          searchVector: buildRepresentationTsvector('keyword_entity', {
            ...tsvectorBase,
            representationContent: keywordContent,
          }),
          weight: 0.6,
          metadata: versionMeta,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      // R2.7: record per-type writes of search_vector. Lets operators observe
      // sparse-lane health distinct from the umbrella rag_representation_enrich_total.
      for (const type of ['contextual_text', 'sample_question', 'summary', 'keyword_entity'] as const) {
        this.metrics.incrementCounter(
          'rag_representation_sparse_populated_total',
          'Count of representation rows written with non-null search_vector',
          { type, source: 'insert' },
        );
      }
    } catch (err) {
      await this.db
        .update(documentChunks)
        .set({ enrichmentStatus: 'failed' })
        .where(eq(documentChunks.id, chunkId));
      return { chunkId, status: 'failed', representationsWritten: 0, reason: `insert failed: ${err}` };
    }

    // 7. Mark succeeded
    await this.db
      .update(documentChunks)
      .set({ enrichmentStatus: 'succeeded' })
      .where(eq(documentChunks.id, chunkId));

    return { chunkId, status: 'succeeded', representationsWritten: 4 };
  }

  private async callLlmWithRetry(
    content: string,
    metaTitle: string | null,
    sectionPath: string | null,
  ): Promise<EnrichmentResponse> {
    const userPrompt = this.buildUserPrompt(content, metaTitle, sectionPath);

    for (let attempt = 0; attempt < 2; attempt++) {
      this.checkCircuitBreaker();

      let raw: string;
      try {
        raw = await this.llm.generate(ENRICHMENT_SYSTEM_PROMPT, userPrompt);
        this.resetCircuitBreaker();
      } catch (err) {
        if (this.is429Error(err)) {
          this.recordCircuitBreakerError();
        }
        if (attempt === 0) {
          this.logger.warn(`LLM call failed on attempt 1 for enrichment, retrying: ${err}`);
          continue;
        }
        throw new Error(`LLM call failed after 2 attempts: ${err}`);
      }

      const parsed = this.parseResponse(raw);
      if (parsed !== null) {
        return parsed;
      }

      if (attempt === 0) {
        this.logger.warn('LLM response parse failed on attempt 1, retrying');
      } else {
        throw new Error('LLM response parse failed after 2 attempts');
      }
    }

    throw new Error('LLM call exhausted retries');
  }

  private buildUserPrompt(
    content: string,
    metaTitle: string | null,
    sectionPath: string | null,
  ): string {
    const lines: string[] = [];
    if (metaTitle) lines.push(`Title: ${metaTitle}`);
    if (sectionPath) lines.push(`Section: ${sectionPath}`);
    lines.push(`Chunk text:\n${content}`);
    return lines.join('\n');
  }

  private parseResponse(raw: string): EnrichmentResponse | null {
    const cleaned = raw.trim().replace(/^```(?:json)?|```$/g, '').trim();
    try {
      const obj = JSON.parse(cleaned) as unknown;
      return enrichmentResponseSchema.parse(obj);
    } catch {
      return null;
    }
  }

  private checkCircuitBreaker(): void {
    if (this.cb.trippedUntil > Date.now()) {
      throw new Error('circuit breaker open: too many consecutive 429 errors');
    }
  }

  private resetCircuitBreaker(): void {
    this.cb.consecutiveErrors = 0;
    this.cb.trippedUntil = 0;
  }

  private recordCircuitBreakerError(): void {
    this.cb.consecutiveErrors += 1;
    if (this.cb.consecutiveErrors >= ChunkRepresentationService.CB_THRESHOLD) {
      const backoffMs = Math.min(60_000, 1_000 * Math.pow(2, this.cb.consecutiveErrors - ChunkRepresentationService.CB_THRESHOLD + 1));
      this.cb.trippedUntil = Date.now() + backoffMs;
      this.metrics.incrementCounter(
        'rag_representation_circuit_breaker_trips_total',
        'Total times the representation enrichment circuit breaker has tripped',
      );
      this.logger.warn(
        `Circuit breaker tripped after ${this.cb.consecutiveErrors} consecutive 429s; ` +
        `backing off for ${backoffMs}ms`,
      );
    }
  }

  private is429Error(err: unknown): boolean {
    if (err instanceof Error) {
      return err.message.includes('429') || err.message.toLowerCase().includes('rate limit');
    }
    return false;
  }
}
