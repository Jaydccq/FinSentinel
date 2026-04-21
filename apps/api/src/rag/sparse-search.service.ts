import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';

export interface SparseSearchFilters {
  docType?: string;
  sector?: string;
  regionId?: string;
  afterDate?: string;
  tickers?: string[];    // NEW — populated by MetadataPreFilterService; SQL consumption in R4.3
  issuerName?: string[]; // NEW — populated by MetadataPreFilterService; SQL consumption in R4.3
  /**
   * Soft hints from the metadata pre-filter. Non-matching rows stay
   * retrievable; matching rows get a `ts_rank_cd` boost (see
   * `SOFT_FILTER_MULTIPLIER`). P3.3 / [RAG-TD-R4-07].
   */
  softFilter?: {
    tickers?: string[];
    issuerName?: string[];
  };
}

/**
 * Multiplier applied to `ts_rank_cd` when a row matches a `softFilter` hint.
 * 1.15 chosen deliberately small so it re-ranks without dominating the
 * absolute score. Raise toward 1.25 if live eval on relational/factoid
 * buckets shows insufficient precision movement.
 */
export const SOFT_FILTER_MULTIPLIER = 1.15;

export interface SparseCandidate {
  chunkId: string;
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

/** (D, C, B, A) weights reading order — matches Postgres `ts_rank_cd(weights, …)` semantics. */
export type SparseWeights = readonly [number, number, number, number];

/**
 * Default sparse ranking weights (`{0.1, 0.2, 0.4, 1.0}`, D→A).
 *
 * Gives A-slot lexemes (title + section_path + entities on representation
 * rows; see `chunk-representation.tsvector.ts`) a 10x multiplier over D-slot
 * lexemes. Override via `RAG_SPARSE_WEIGHTS` env var — parsed by
 * `config/rag.config.ts`.
 */
export const DEFAULT_SPARSE_WEIGHTS: SparseWeights = [0.1, 0.2, 0.4, 1.0];

/**
 * Formats a weight tuple as a Postgres array literal, e.g. `{0.1,0.2,0.4,1}`.
 * The value is passed to SQL as a single bound parameter and cast to
 * `float4[]` in the query, never string-interpolated.
 */
function formatWeightsLiteral(weights: SparseWeights): string {
  return `{${weights.join(',')}}`;
}

@Injectable()
export class SparseSearchService {
  private readonly logger = new Logger(SparseSearchService.name);
  private readonly weightsLiteral: string;

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    /**
     * Optional second arg. Accepts either:
     * - a `ConfigService` (Nest DI path) — reads `rag.retrieval.sparseWeights`
     * - a `SparseWeights` tuple (test path) — used directly
     * - undefined — falls back to `DEFAULT_SPARSE_WEIGHTS`
     *
     * Note on GIN index compatibility: `ts_rank_cd` with the partial GIN
     * index on `document_chunk_representations.search_vector` (V16 migration)
     * uses the index for candidate filtering but computes ranks over the
     * filtered set without true positional/proximity info (GIN stores no
     * positions). Field-weighted A/B/C ranking still works — that is all we
     * need for Wave 2. Do not "fix" the GIN to GIST without re-evaluating;
     * field weights, not proximity, are the lever here.
     */
    @Optional() configOrWeights?: ConfigService | SparseWeights,
  ) {
    this.weightsLiteral = formatWeightsLiteral(
      SparseSearchService.resolveWeights(configOrWeights),
    );
  }

  private static resolveWeights(
    configOrWeights: ConfigService | SparseWeights | undefined,
  ): SparseWeights {
    if (!configOrWeights) return DEFAULT_SPARSE_WEIGHTS;
    if (Array.isArray(configOrWeights)) {
      return configOrWeights as SparseWeights;
    }
    // ConfigService — `rag.retrieval.sparseWeights` is validated at config
    // load time (see config/rag.config.ts), so a bad env var fails at
    // startup, not at query time.
    const fromConfig = (configOrWeights as ConfigService).get<SparseWeights>(
      'rag.retrieval.sparseWeights',
    );
    return fromConfig ?? DEFAULT_SPARSE_WEIGHTS;
  }

  async search(
    query: string,
    filters: SparseSearchFilters,
    topK: number,
  ): Promise<SparseCandidate[]> {
    if (!query.trim()) return [];

    const candidateLimit = Math.max(topK * 4, 100);
    const weights = this.weightsLiteral;

    const chunkFilterClauses = [sql`search_vector @@ websearch_to_tsquery('simple', ${query})`];
    const repFilterClauses = [
      sql`r.search_vector @@ websearch_to_tsquery('simple', ${query})`,
      sql`r.representation_type IN ('contextual_text', 'sample_question', 'keyword_entity')`,
    ];
    if (filters.docType) {
      chunkFilterClauses.push(sql`metadata->>'doc_type' = ${filters.docType}`);
      repFilterClauses.push(sql`dc.metadata->>'doc_type' = ${filters.docType}`);
    }
    if (filters.sector) {
      chunkFilterClauses.push(sql`metadata->>'sector' = ${filters.sector}`);
      repFilterClauses.push(sql`dc.metadata->>'sector' = ${filters.sector}`);
    }
    if (filters.regionId) {
      chunkFilterClauses.push(sql`metadata->>'region_id' = ${filters.regionId}`);
      repFilterClauses.push(sql`dc.metadata->>'region_id' = ${filters.regionId}`);
    }
    if (filters.afterDate) {
      chunkFilterClauses.push(sql`metadata->>'date' >= ${filters.afterDate}`);
      repFilterClauses.push(sql`dc.metadata->>'date' >= ${filters.afterDate}`);
    }
    if (filters.tickers && filters.tickers.length > 0) {
      chunkFilterClauses.push(sql`(metadata->'tickers') ?| ${filters.tickers}::text[]`);
      repFilterClauses.push(sql`(dc.metadata->'tickers') ?| ${filters.tickers}::text[]`);
    }
    if (filters.issuerName && filters.issuerName.length > 0) {
      chunkFilterClauses.push(sql`metadata->>'issuerName' = ANY(${filters.issuerName}::text[])`);
      repFilterClauses.push(sql`dc.metadata->>'issuerName' = ANY(${filters.issuerName}::text[])`);
    }

    // P3.3 ([RAG-TD-R4-07]): soft hints rank-boost but do NOT restrict.
    // Build a multiplier expression per lane — CASE WHEN <soft-match>
    // THEN SOFT_FILTER_MULTIPLIER ELSE 1.0 END — applied as
    // ts_rank_cd(...) * <boost>. When no soft hints apply, the multiplier
    // collapses to constant 1.0 so the planner sees no change.
    const softTickers = filters.softFilter?.tickers;
    const softIssuers = filters.softFilter?.issuerName;
    const hasAnySoft = (softTickers && softTickers.length > 0)
      || (softIssuers && softIssuers.length > 0);

    // Helper: build the canonical-lane CASE (no table alias on metadata).
    const canonicalCaseArms = [];
    if (softTickers && softTickers.length > 0) {
      canonicalCaseArms.push(
        sql`WHEN (metadata->'tickers') ?| ${softTickers}::text[] THEN ${SOFT_FILTER_MULTIPLIER}`,
      );
    }
    if (softIssuers && softIssuers.length > 0) {
      canonicalCaseArms.push(
        sql`WHEN metadata->>'issuerName' = ANY(${softIssuers}::text[]) THEN ${SOFT_FILTER_MULTIPLIER}`,
      );
    }
    const canonicalBoost = hasAnySoft
      ? sql`CASE ${sql.join(canonicalCaseArms, sql` `)} ELSE 1.0 END`
      : sql`1.0`;

    // Rep lane uses `dc.metadata` because the JOIN brings the canonical
    // metadata into scope under the `dc` alias.
    const repCaseArms = [];
    if (softTickers && softTickers.length > 0) {
      repCaseArms.push(
        sql`WHEN (dc.metadata->'tickers') ?| ${softTickers}::text[] THEN ${SOFT_FILTER_MULTIPLIER}`,
      );
    }
    if (softIssuers && softIssuers.length > 0) {
      repCaseArms.push(
        sql`WHEN dc.metadata->>'issuerName' = ANY(${softIssuers}::text[]) THEN ${SOFT_FILTER_MULTIPLIER}`,
      );
    }
    const repBoost = hasAnySoft
      ? sql`CASE ${sql.join(repCaseArms, sql` `)} ELSE 1.0 END`
      : sql`1.0`;

    const rows = await this.db.execute(sql`
      WITH canonical_ranked AS (
        SELECT
          id,
          source_id,
          content,
          metadata,
          ts_rank_cd(${weights}::float4[], search_vector, websearch_to_tsquery('simple', ${query}))
            * (${canonicalBoost}) AS rank_score
        FROM document_chunks
        WHERE ${sql.join(chunkFilterClauses, sql` AND `)}
        ORDER BY rank_score DESC
        LIMIT ${candidateLimit}
      ),
      rep_ranked AS (
        SELECT
          dc.id,
          dc.source_id,
          dc.content,
          dc.metadata,
          MAX(
            ts_rank_cd(${weights}::float4[], r.search_vector, websearch_to_tsquery('simple', ${query}))
              * (${repBoost})
          ) AS rank_score
        FROM document_chunk_representations r
        JOIN document_chunks dc ON dc.id = r.chunk_id
        WHERE ${sql.join(repFilterClauses, sql` AND `)}
        GROUP BY dc.id, dc.source_id, dc.content, dc.metadata
        ORDER BY rank_score DESC
        LIMIT ${candidateLimit}
      ),
      merged AS (
        SELECT id, source_id, content, metadata,
          MAX(rank_score) AS rank_score
        FROM (
          SELECT * FROM canonical_ranked
          UNION ALL
          SELECT * FROM rep_ranked
        ) combined
        GROUP BY id, source_id, content, metadata
      ),
      source_counts AS (
        SELECT source_id, count(*)::int AS hit_count
        FROM merged GROUP BY source_id
      )
      SELECT m.id, m.source_id, m.content, m.metadata,
        m.rank_score, sc.hit_count
      FROM merged m
      JOIN source_counts sc ON m.source_id = sc.source_id
      ORDER BY m.rank_score * (1 + 0.1 * ln(sc.hit_count::float)) DESC
      LIMIT ${topK}
    `);

    return (rows as any[]).map((row) => ({
      chunkId: row.id,
      sourceId: row.source_id,
      content: row.content,
      metadata: row.metadata,
      score: row.rank_score * (1 + 0.1 * Math.log(row.hit_count)),
    }));
  }
}
