import { Inject, Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class SparseSearchService {
  private readonly logger = new Logger(SparseSearchService.name);

  constructor(@Inject('DRIZZLE_DB') private readonly db: DrizzleDB) {}

  async search(
    query: string,
    filters: SparseSearchFilters,
    topK: number,
  ): Promise<SparseCandidate[]> {
    if (!query.trim()) return [];

    const candidateLimit = Math.max(topK * 4, 100);

    const filterClauses = [sql`search_vector @@ websearch_to_tsquery('simple', ${query})`];
    if (filters.docType) {
      filterClauses.push(sql`metadata->>'doc_type' = ${filters.docType}`);
    }
    if (filters.sector) {
      filterClauses.push(sql`metadata->>'sector' = ${filters.sector}`);
    }
    if (filters.regionId) {
      filterClauses.push(sql`metadata->>'region_id' = ${filters.regionId}`);
    }
    if (filters.afterDate) {
      filterClauses.push(sql`metadata->>'date' >= ${filters.afterDate}`);
    }

    const rows = await this.db.execute(sql`
      WITH ranked AS (
        SELECT
          id,
          source_id,
          content,
          metadata,
          ts_rank_cd(search_vector, websearch_to_tsquery('simple', ${query})) AS rank_score
        FROM document_chunks
        WHERE ${sql.join(filterClauses, sql` AND `)}
        ORDER BY rank_score DESC
        LIMIT ${candidateLimit}
      ),
      source_counts AS (
        SELECT source_id, count(*)::int AS hit_count
        FROM ranked GROUP BY source_id
      )
      SELECT r.id, r.source_id, r.content, r.metadata,
        r.rank_score, sc.hit_count
      FROM ranked r
      JOIN source_counts sc ON r.source_id = sc.source_id
      ORDER BY r.rank_score * (1 + 0.1 * ln(sc.hit_count::float)) DESC
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
