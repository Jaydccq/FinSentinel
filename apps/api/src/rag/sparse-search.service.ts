import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';

export interface SparseSearchFilters {
  docType?: string;
  sector?: string;
  regionId?: string;
  afterDate?: string;
}

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

    const rows = await this.db.execute(sql`
      WITH canonical_ranked AS (
        SELECT
          id,
          source_id,
          content,
          metadata,
          ts_rank_cd(${weights}::float4[], search_vector, websearch_to_tsquery('simple', ${query})) AS rank_score
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
          MAX(ts_rank_cd(${weights}::float4[], r.search_vector, websearch_to_tsquery('simple', ${query}))) AS rank_score
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
