import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { MetricsService } from '../common/services/metrics.service';
import type { DrizzleDB } from '@finsentinel/db';

export interface ShadowComparisonInput {
  queryHash: string;
  queryClass: string;
  singleStageChunkIds: string[];
  multiStageChunkIds: string[];
  singleStageLatencyMs: number | null;
  multiStageLatencyMs: number | null;
  shadowTimedOut: boolean;
  shadowDroppedBackpressure: boolean;
  multiStageError: string | null;
}

export interface RagTraceInput {
  userId?: string | null;
  query: string;
  queryClass?: string;
  variants?: Array<{ kind: string; query: string }>;
  filters: Record<string, unknown>;
  lanes: string[];
  resultChunkIds: string[];
  laneCounts: Record<string, number>;
  /**
   * Representation types (e.g. 'canonical', 'contextual_text', 'sample_question')
   * seen across the top-K packed chunks. Folded into lane_counts jsonb under the
   * reserved __reps sub-key to avoid a schema migration:
   *   lane_counts = { dense: 60, sparse: 45, __reps: ['canonical', 'contextual_text'] }
   */
  representationTypesSeen?: string[];
  timingsMs: Record<string, number>;
  fallbackFlags: string[];
  rerankReason?: string | null;
  totalMs?: number;
}

/**
 * Writes per-query trace rows to rag_query_logs.
 *
 * Sampling decision — deterministic hash bucket:
 *   crypto.createHash('sha256').update(queryHash).digest()[0] / 255 < sampleRate
 *
 * Using the first byte of sha256(queryHash) instead of Math.random() means the
 * same query consistently falls in or out of the sample window during a test
 * period, which makes golden-set mining reproducible. Fallback-flagged queries
 * and non-null rerankReason queries are always logged regardless of sample rate
 * so failure mining never gets sampled out.
 *
 * INSERT uses raw SQL to guarantee every column is set, avoiding the
 * Drizzle 0.44.x + postgres.js 3.4.9 mixed-default bind bug (CLAUDE.md).
 */
@Injectable()
export class RagTraceService {
  private readonly logger = new Logger(RagTraceService.name);
  private readonly sampleRate: number;
  private readonly piiEnabled: boolean;

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    configService: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.sampleRate = configService.get<number>('rag.queryLog.sampleRate', 1.0);
    this.piiEnabled = configService.get<boolean>('rag.queryLog.piiEnabled', false) as boolean;
  }

  async recordTrace(input: RagTraceInput): Promise<void> {
    try {
      const queryHash = createHash('sha256').update(input.query).digest('hex');

      const alwaysLog = input.fallbackFlags.length > 0 || !!input.rerankReason;
      if (!alwaysLog && !this.shouldSample(queryHash)) {
        return;
      }

      const queryPreview = this.piiEnabled ? input.query.slice(0, 500) : null;

      const variantRows = (input.variants ?? []).map((v) => ({
        kind: v.kind,
        query_hash: createHash('sha256').update(v.query).digest('hex'),
      }));

      // Fold representationTypesSeen into lane_counts under the reserved __reps
      // sub-key. This avoids a migration while surfacing provenance for failure
      // mining. Consumers must treat __reps as a string[] in the jsonb object.
      const laneCountsPayload: Record<string, unknown> = { ...input.laneCounts };
      if (input.representationTypesSeen && input.representationTypesSeen.length > 0) {
        laneCountsPayload['__reps'] = input.representationTypesSeen;
      }

      const labelKind = alwaysLog ? 'always_logged' : 'sampled';
      this.metrics?.incrementCounter(
        'rag_trace_writes_total',
        'Total RAG query trace rows written',
        { kind: labelKind },
      );

      // Raw SQL INSERT — every column set explicitly (per CLAUDE.md rule).
      await this.db.execute(sql`
        INSERT INTO rag_query_logs (
          id,
          user_id,
          query_hash,
          query_preview,
          query_class,
          variants,
          filters,
          lanes,
          result_chunk_ids,
          lane_counts,
          timings_ms,
          fallback_flags,
          rerank_reason,
          total_ms,
          created_at
        ) VALUES (
          gen_random_uuid(),
          ${input.userId ?? null},
          ${queryHash},
          ${queryPreview},
          ${input.queryClass ?? null},
          ${JSON.stringify(variantRows)}::jsonb,
          ${JSON.stringify(input.filters)}::jsonb,
          ${input.lanes}::varchar[],
          ${input.resultChunkIds}::uuid[],
          ${JSON.stringify(laneCountsPayload)}::jsonb,
          ${JSON.stringify(input.timingsMs)}::jsonb,
          ${input.fallbackFlags}::varchar[],
          ${input.rerankReason ?? null},
          ${input.totalMs ?? null},
          now()
        )
      `);
    } catch (err) {
      this.logger.warn(`RagTraceService.recordTrace failed: ${err}`);
    }
  }

  async recordShadowComparison(input: ShadowComparisonInput): Promise<void> {
    try {
      await this.db.execute(sql`
        INSERT INTO rag_shadow_comparisons (
          id, query_hash, query_class,
          single_stage_chunk_ids, multi_stage_chunk_ids,
          single_stage_latency_ms, multi_stage_latency_ms,
          shadow_timed_out, shadow_dropped_backpressure,
          multi_stage_error, created_at
        ) VALUES (
          gen_random_uuid(),
          ${input.queryHash},
          ${input.queryClass},
          ${input.singleStageChunkIds}::text[],
          ${input.multiStageChunkIds}::text[],
          ${input.singleStageLatencyMs},
          ${input.multiStageLatencyMs},
          ${input.shadowTimedOut},
          ${input.shadowDroppedBackpressure},
          ${input.multiStageError},
          now()
        )
      `);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to persist shadow comparison: ${msg}`);
    }
  }

  private shouldSample(queryHash: string): boolean {
    if (this.sampleRate >= 1.0) return true;
    if (this.sampleRate <= 0) return false;
    const bucket = createHash('sha256').update(queryHash).digest()[0]! / 255;
    return bucket < this.sampleRate;
  }
}
