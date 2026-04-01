import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';

export interface RagSearchResult {
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

export interface RagSearchOptions {
  query: string;
  topK?: number;
  docType?: string;
  sector?: string;
  regionId?: string;
  afterDate?: string;
}

/**
 * RAG retrieval service -- pgvector cosine similarity search.
 *
 * Executes vector similarity queries against the document_chunks table
 * stored in pgvector. Supports filtering by docType, sector, regionId,
 * and afterDate.
 *
 * The search method:
 * 1. Embeds the query text (stub until embedding model is wired)
 * 2. Builds a dynamic WHERE clause from provided filters
 * 3. Runs cosine similarity search with threshold filtering
 * 4. Returns ranked results with similarity scores
 */
@Injectable()
export class RagRetrievalService {
  private readonly logger = new Logger(RagRetrievalService.name);
  private readonly similarityThreshold: number;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
    configService: ConfigService,
  ) {
    this.similarityThreshold = configService.get<number>('RAG_SIMILARITY_THRESHOLD', 0.65);
  }

  /**
   * Search for similar documents using pgvector cosine similarity.
   *
   * Accepts either positional args (backward-compatible) or an options object.
   */
  async search(
    queryOrOptions: string | RagSearchOptions,
    topK?: number,
    docType?: string,
    sector?: string,
    regionId?: string,
    afterDate?: string,
  ): Promise<RagSearchResult[]> {
    // Normalize to options object
    const opts: RagSearchOptions =
      typeof queryOrOptions === 'string'
        ? { query: queryOrOptions, topK, docType, sector, regionId, afterDate }
        : queryOrOptions;

    // Clamp topK to [1, 50]
    const safeTopK = Math.min(Math.max(opts.topK ?? 5, 1), 50);

    this.logger.debug(
      `RAG search: query="${opts.query.substring(0, 50)}..." topK=${safeTopK} ` +
      `docType=${opts.docType ?? 'any'} sector=${opts.sector ?? 'any'} ` +
      `region=${opts.regionId ?? 'any'} after=${opts.afterDate ?? 'any'}`,
    );

    // Build the query with dynamic filters
    return this.executeVectorSearch(opts.query, safeTopK, opts);
  }

  /**
   * Execute vector similarity search against pgvector.
   *
   * Builds dynamic WHERE clauses based on provided metadata filters.
   * Uses cosine distance operator (<=>) for similarity computation.
   */
  private async executeVectorSearch(
    query: string,
    topK: number,
    opts: RagSearchOptions,
  ): Promise<RagSearchResult[]> {
    // TODO: Embed the query text using the embedding model.
    // const { embedding } = await embed({ model, value: query });
    //
    // For now, we cannot perform vector search without an embedding.
    // Return empty results until the embedding model is wired.

    // Build WHERE conditions
    const conditions = this.buildFilterConditions(opts);
    const conditionsSummary = conditions.length > 0
      ? conditions.map((c) => c.label).join(', ')
      : 'none';

    this.logger.debug(
      `[STUB] Vector search: topK=${topK}, threshold=${this.similarityThreshold}, ` +
      `filters=[${conditionsSummary}]`,
    );

    // Actual implementation (commented out until embedding model is available):
    //
    // const embeddingVector = `[${embedding.join(',')}]`;
    //
    // const whereClause = conditions.length > 0
    //   ? sql.join([sql`WHERE`, ...conditions.map(c => c.sql)], sql` AND `)
    //   : sql``;
    //
    // const results = await this.db.execute(sql`
    //   SELECT
    //     content,
    //     metadata,
    //     1 - (embedding <=> ${embeddingVector}::vector) AS similarity
    //   FROM document_chunks
    //   ${whereClause}
    //     ${conditions.length > 0 ? sql`AND` : sql`WHERE`}
    //     1 - (embedding <=> ${embeddingVector}::vector) >= ${this.similarityThreshold}
    //   ORDER BY similarity DESC
    //   LIMIT ${topK}
    // `);
    //
    // return results.rows.map(row => ({
    //   content: row.content,
    //   metadata: row.metadata,
    //   similarity: Number(row.similarity),
    // }));

    return [];
  }

  /**
   * Build SQL filter conditions from search options.
   *
   * Each filter is optional — only non-null/undefined values produce conditions.
   */
  private buildFilterConditions(
    opts: RagSearchOptions,
  ): Array<{ label: string; sql: ReturnType<typeof sql> }> {
    const conditions: Array<{ label: string; sql: ReturnType<typeof sql> }> = [];

    if (opts.docType) {
      conditions.push({
        label: `docType=${opts.docType}`,
        sql: sql`metadata->>'doc_type' = ${opts.docType}`,
      });
    }

    if (opts.sector) {
      conditions.push({
        label: `sector=${opts.sector}`,
        sql: sql`metadata->>'sector' = ${opts.sector}`,
      });
    }

    if (opts.regionId) {
      conditions.push({
        label: `regionId=${opts.regionId}`,
        sql: sql`metadata->>'region_id' = ${opts.regionId}`,
      });
    }

    if (opts.afterDate) {
      conditions.push({
        label: `afterDate=${opts.afterDate}`,
        sql: sql`metadata->>'date' >= ${opts.afterDate}`,
      });
    }

    return conditions;
  }

  /** Returns the configured similarity threshold. */
  getThreshold(): number {
    return this.similarityThreshold;
  }
}
