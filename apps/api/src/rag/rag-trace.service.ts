import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { MetricsService } from '../common/services/metrics.service';
import type { DrizzleDB } from '@finsentinel/db';

export interface RagTraceInput {
  userId?: string | null;
  query: string;
  queryClass?: string;
  variants?: Array<{ kind: string; query: string }>;
  filters: Record<string, unknown>;
  lanes: string[];
  resultChunkIds: string[];
  laneCounts: Record<string, number>;
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
          ${JSON.stringify(input.laneCounts)}::jsonb,
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

  private shouldSample(queryHash: string): boolean {
    if (this.sampleRate >= 1.0) return true;
    if (this.sampleRate <= 0) return false;
    const bucket = createHash('sha256').update(queryHash).digest()[0]! / 255;
    return bucket < this.sampleRate;
  }
}
