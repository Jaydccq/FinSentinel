/**
 * representation-admin.service.ts
 *
 * Shared service for T2.C backfill and reindex CLIs.
 *
 * Semver note: `semver` is not a project dependency. Version comparison uses
 * simple string compare on the `rep-vX.Y` convention. Versions must follow the
 * pattern `rep-v<major>.<minor>` (e.g. rep-v1.0, rep-v1.1, rep-v2.0).
 * String comparison works correctly for this scheme because:
 *   rep-v1.0 < rep-v1.1 < rep-v2.0 (lexicographic order matches version order
 *   as long as minor and major components are single digits).
 * If double-digit components are ever needed, migrate to semver.
 *
 * Cost estimate constants (used for operator awareness, not invoicing):
 *   - 1 LLM call per chunk, assume ~2 000 input tokens + 300 output tokens
 *   - 2 embedding API calls per chunk, assume ~300 tokens each
 *   - LLM rate: $0.000_15 / 1 000 tokens (conservative mid-tier model proxy)
 *   - Embedding rate: $0.000_02 / 1 000 tokens
 * These are documented inline and overridable via config in the future; for v1
 * they are hardcoded constants because operators only need order-of-magnitude
 * awareness, not invoicing precision.
 */

import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  documentChunks,
  documentChunkRepresentations,
  eq,
  and,
  sql,
} from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { CURRENT_REPRESENTATION_VERSION, RAG_REPRESENTATION_BATCH_SIZE_DEFAULT } from '../chunk-representation.service';
import { RepresentationEnrichProducer } from '../../queue/representation-enrich.producer';

// ── Cost estimate constants ────────────────────────────────────────────────────

/** Assumed LLM tokens per chunk (input + output combined). */
const LLM_TOKENS_PER_CHUNK = 2_300;

/** Assumed embedding tokens per call. Two calls per chunk. */
const EMBEDDING_TOKENS_PER_CALL = 300;

/** Conservative mid-tier LLM proxy cost: USD per 1 000 tokens. */
const LLM_COST_PER_1K_TOKENS_USD = 0.000_15;

/** Embedding cost: USD per 1 000 tokens. */
const EMBEDDING_COST_PER_1K_TOKENS_USD = 0.000_02;

// ── Public types ───────────────────────────────────────────────────────────────

export interface ChunkFilterOptions {
  sourceType?: string;
  sourceId?: string;
  limit?: number;
}

export interface ChunkRow {
  id: string;
  sourceType: string;
  sourceId: string;
  enrichmentStatus: string;
}

export interface CostEstimate {
  llmCalls: number;
  embeddingCalls: number;
  estimatedUsd: number;
}

export interface EnqueueResult {
  enqueued: number;
  cappedAt: number | null;
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class RepresentationAdminService {
  private readonly logger = new Logger(RepresentationAdminService.name);
  private readonly batchSize: number;

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly producer: RepresentationEnrichProducer,
    private readonly configService: ConfigService,
  ) {
    this.batchSize = this.configService.get<number>(
      'RAG_REPRESENTATION_BATCH_SIZE',
      RAG_REPRESENTATION_BATCH_SIZE_DEFAULT,
    );
  }

  /**
   * Returns chunks with `enrichment_status = 'pending'` OR missing a
   * representation row at the current version.
   *
   * "Missing at current version" means there is no row in
   * document_chunk_representations with metadata->>'index_version' equal to
   * CURRENT_REPRESENTATION_VERSION for that chunk.
   *
   * Applies optional source_type / source_id / limit filters.
   */
  async listUnenrichedChunks(options: ChunkFilterOptions = {}): Promise<ChunkRow[]> {
    const { sourceType, sourceId, limit } = options;

    // Subquery: chunk IDs that already have a representation at current version
    const enrichedSubquery = this.db
      .select({ chunkId: documentChunkRepresentations.chunkId })
      .from(documentChunkRepresentations)
      .where(
        sql`${documentChunkRepresentations.metadata}->>'index_version' = ${CURRENT_REPRESENTATION_VERSION}`,
      );

    const conditions = [
      // chunk is either pending OR not yet enriched at current version
      sql`(
        ${documentChunks.enrichmentStatus} = 'pending'
        OR ${documentChunks.id} NOT IN (${enrichedSubquery})
      )`,
    ];

    if (sourceType) {
      conditions.push(eq(documentChunks.sourceType, sourceType));
    }
    if (sourceId) {
      conditions.push(eq(documentChunks.sourceId, sourceId));
    }

    const query = this.db
      .select({
        id: documentChunks.id,
        sourceType: documentChunks.sourceType,
        sourceId: documentChunks.sourceId,
        enrichmentStatus: documentChunks.enrichmentStatus,
      })
      .from(documentChunks)
      .where(and(...conditions));

    if (limit !== undefined && limit > 0) {
      return query.limit(limit);
    }

    return query;
  }

  /**
   * Returns chunks whose highest-version representation row has
   * metadata->>'index_version' <= fromVersion (string comparison).
   *
   * Chunks with NO representation rows are not returned here; those are
   * covered by listUnenrichedChunks.
   *
   * Uses string comparison: rep-v1.0 < rep-v1.1 < rep-v2.0.
   * Valid only for single-digit major/minor components. See module header.
   */
  async listStaleVersionChunks(
    fromVersion: string,
    limit?: number,
  ): Promise<ChunkRow[]> {
    // MAX over the JSONB version string; using string comparison in Postgres.
    // We select chunks where their max representation version <= fromVersion.
    const staleSubquery = this.db
      .select({ chunkId: documentChunkRepresentations.chunkId })
      .from(documentChunkRepresentations)
      .groupBy(documentChunkRepresentations.chunkId)
      .having(
        sql`MAX(${documentChunkRepresentations.metadata}->>'index_version') <= ${fromVersion}`,
      );

    const query = this.db
      .select({
        id: documentChunks.id,
        sourceType: documentChunks.sourceType,
        sourceId: documentChunks.sourceId,
        enrichmentStatus: documentChunks.enrichmentStatus,
      })
      .from(documentChunks)
      .where(sql`${documentChunks.id} IN (${staleSubquery})`);

    if (limit !== undefined && limit > 0) {
      return query.limit(limit);
    }

    return query;
  }

  /**
   * Rough cost estimate for operator awareness.
   *
   * Assumes 1 LLM call per chunk and 2 embedding calls per chunk.
   * See module header for constant documentation.
   */
  estimateCost(chunkCount: number): CostEstimate {
    const llmCalls = chunkCount;
    const embeddingCalls = chunkCount * 2;

    const llmUsd = (llmCalls * LLM_TOKENS_PER_CHUNK * LLM_COST_PER_1K_TOKENS_USD) / 1_000;
    const embeddingUsd =
      (embeddingCalls * EMBEDDING_TOKENS_PER_CALL * EMBEDDING_COST_PER_1K_TOKENS_USD) / 1_000;

    return {
      llmCalls,
      embeddingCalls,
      estimatedUsd: Number((llmUsd + embeddingUsd).toFixed(4)),
    };
  }

  /**
   * Enqueues chunk IDs for enrichment via RepresentationEnrichProducer.
   *
   * The producer internally enforces RAG_REPRESENTATION_MAX_CHUNKS_PER_DOC
   * (per-source cap). This method delegates directly and returns the count
   * that was accepted (post-cap).
   *
   * Returns the count enqueued.
   */
  async enqueueForEnrichment(chunkIds: string[]): Promise<number> {
    if (chunkIds.length === 0) return 0;

    const cap = this.configService.get<number>('RAG_REPRESENTATION_MAX_CHUNKS_PER_DOC', 2_000);
    const ids = chunkIds.length > cap ? chunkIds.slice(0, cap) : chunkIds;

    if (ids.length < chunkIds.length) {
      this.logger.warn(
        `enqueueForEnrichment: capping ${chunkIds.length} chunk IDs to ${cap} (RAG_REPRESENTATION_MAX_CHUNKS_PER_DOC)`,
      );
    }

    await this.producer.enqueueMany(ids);
    return ids.length;
  }

  /** Default batch size from config (for CLI progress reporting). */
  getBatchSize(): number {
    return this.batchSize;
  }
}
