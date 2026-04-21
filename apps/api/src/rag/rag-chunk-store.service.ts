import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, documentChunks, eq, sql } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';

export interface RagChunkRecord {
  id: string;
  sourceType: 'document' | 'news';
  sourceId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

// P3.2 ([RAG-TD-R4-03]): the dense lane now mirrors the sparse lane's
// ticker + issuerName JSONB filters so a high-confidence extraction
// restricts BOTH lanes at the SQL layer. Prior behavior let dense-lane
// noise dilute RRF precision on exact_lookup queries.
export interface RagChunkSearchFilters {
  docType?: string;
  sector?: string;
  regionId?: string;
  afterDate?: string;
  tickers?: string[];
  issuerName?: string[];
  limit?: number;
}

export type RepresentationType = 'canonical' | 'contextual_text' | 'sample_question';

export interface RepresentationHit {
  chunkId: string;
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  representationType: RepresentationType;
}

@Injectable()
export class RagChunkStoreService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
  ) {}

  async replaceChunks(
    sourceType: 'document' | 'news',
    sourceId: string,
    chunks: Array<{
      content: string;
      embedding: number[];
      metadata: Record<string, unknown>;
      /** Joined section path string, e.g. "Chapter 1 / 1.2 Risks". Defaults to null. */
      sectionPath?: string | null;
      /** Closest enclosing heading text. Defaults to null. */
      title?: string | null;
    }>,
  ): Promise<void> {
    // CASCADE on document_chunk_representations.chunk_id removes representation rows automatically
    await this.db
      .delete(documentChunks)
      .where(
        and(
          eq(documentChunks.sourceType, sourceType),
          eq(documentChunks.sourceId, sourceId),
        ),
      );

    if (chunks.length === 0) {
      return;
    }

    await this.db.insert(documentChunks).values(
      chunks.map((chunk, chunkIndex) => ({
        id: randomUUID(),
        sourceType,
        sourceId,
        chunkIndex,
        content: chunk.content,
        embedding: chunk.embedding,
        metadata: chunk.metadata,
        metaTitle: (chunk.title ?? (chunk.metadata['title'] as string)) ?? null,
        metaSource: (chunk.metadata['source'] as string) ?? null,
        metaEntities: null, // populated later by GraphEnrichmentConsumer
        parentId: null,
        sectionPath: chunk.sectionPath ?? null,
        enrichmentStatus: 'pending',
      })),
    );

    // Build search_vector for newly inserted chunks
    await this.db.execute(sql`
      UPDATE document_chunks
      SET search_vector =
        setweight(to_tsvector('simple', coalesce(meta_title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(meta_source, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(meta_entities, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(content, '')), 'B')
      WHERE source_type = ${sourceType} AND source_id = ${sourceId}
    `);
  }

  async search(
    queryEmbedding: number[],
    filters: RagChunkSearchFilters,
  ): Promise<Array<RagChunkRecord & { similarity: number }>> {
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    const clauses = [];
    if (filters.docType) {
      clauses.push(sql`${documentChunks.metadata}->>'doc_type' = ${filters.docType}`);
    }
    if (filters.sector) {
      clauses.push(sql`${documentChunks.metadata}->>'sector' = ${filters.sector}`);
    }
    if (filters.regionId) {
      clauses.push(sql`${documentChunks.metadata}->>'region_id' = ${filters.regionId}`);
    }
    if (filters.afterDate) {
      clauses.push(sql`${documentChunks.metadata}->>'date' >= ${filters.afterDate}`);
    }

    const whereClause = clauses.length > 0
      ? sql`WHERE ${sql.join(clauses, sql` AND `)}`
      : sql``;

    const rows = await this.db.execute(sql`
      SELECT
        id,
        source_type AS "sourceType",
        source_id AS "sourceId",
        chunk_index AS "chunkIndex",
        content,
        metadata,
        1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM document_chunks
      ${whereClause}
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${filters.limit ?? 500}
    `);

    return (rows as any[]).map((row) => ({
      id: row.id as string,
      sourceType: row.sourceType as 'document' | 'news',
      sourceId: row.sourceId,
      chunkIndex: row.chunkIndex,
      content: row.content,
      embedding: [],
      metadata: row.metadata,
      similarity: row.similarity,
    }));
  }

  /**
   * Search across multiple chunk representations (canonical + contextual_text +
   * sample_question) in parallel and return one hit per (chunkId, representationType).
   *
   * `types` defaults to all three surfaces. Pass a subset to narrow.
   * When `document_chunk_representations` has no rows for a given type, that
   * sub-query returns an empty array — canonical results are always attempted.
   */
  async searchRepresentations(
    queryEmbedding: number[],
    filters: Omit<RagChunkSearchFilters, 'limit'>,
    topK: number,
    types: RepresentationType[] = ['canonical', 'contextual_text', 'sample_question'],
  ): Promise<RepresentationHit[]> {
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    const metaFilterClauses = [];
    if (filters.docType) {
      metaFilterClauses.push(sql`dc.metadata->>'doc_type' = ${filters.docType}`);
    }
    if (filters.sector) {
      metaFilterClauses.push(sql`dc.metadata->>'sector' = ${filters.sector}`);
    }
    if (filters.regionId) {
      metaFilterClauses.push(sql`dc.metadata->>'region_id' = ${filters.regionId}`);
    }
    if (filters.afterDate) {
      metaFilterClauses.push(sql`dc.metadata->>'date' >= ${filters.afterDate}`);
    }
    // P3.2: mirror sparse lane's ticker + issuerName JSONB filters ([RAG-TD-R4-03]).
    if (filters.tickers && filters.tickers.length > 0) {
      metaFilterClauses.push(sql`(dc.metadata->'tickers') ?| ${filters.tickers}::text[]`);
    }
    if (filters.issuerName && filters.issuerName.length > 0) {
      metaFilterClauses.push(sql`dc.metadata->>'issuerName' = ANY(${filters.issuerName}::text[])`);
    }

    const metaWhere =
      metaFilterClauses.length > 0
        ? sql`AND ${sql.join(metaFilterClauses, sql` AND `)}`
        : sql``;

    const subQueries: Promise<RepresentationHit[]>[] = [];

    if (types.includes('canonical')) {
      const canonicalFilter = [];
      if (filters.docType) {
        canonicalFilter.push(sql`metadata->>'doc_type' = ${filters.docType}`);
      }
      if (filters.sector) {
        canonicalFilter.push(sql`metadata->>'sector' = ${filters.sector}`);
      }
      if (filters.regionId) {
        canonicalFilter.push(sql`metadata->>'region_id' = ${filters.regionId}`);
      }
      if (filters.afterDate) {
        canonicalFilter.push(sql`metadata->>'date' >= ${filters.afterDate}`);
      }
      // P3.2: canonical lane also filters on tickers + issuerName ([RAG-TD-R4-03]).
      if (filters.tickers && filters.tickers.length > 0) {
        canonicalFilter.push(sql`(metadata->'tickers') ?| ${filters.tickers}::text[]`);
      }
      if (filters.issuerName && filters.issuerName.length > 0) {
        canonicalFilter.push(sql`metadata->>'issuerName' = ANY(${filters.issuerName}::text[])`);
      }
      const canonicalWhere =
        canonicalFilter.length > 0
          ? sql`WHERE ${sql.join(canonicalFilter, sql` AND `)}`
          : sql``;

      subQueries.push(
        this.db
          .execute(
            sql`
              SELECT
                id AS chunk_id,
                source_id,
                chunk_index,
                content,
                metadata,
                meta_title,
                section_path,
                1 - (embedding <=> ${vectorStr}::vector) AS similarity
              FROM document_chunks
              ${canonicalWhere}
              ORDER BY embedding <=> ${vectorStr}::vector
              LIMIT ${topK}
            `,
          )
          .then((rows) =>
            (rows as any[]).map((row) => ({
              chunkId: row.chunk_id as string,
              sourceId: row.source_id as string,
              content: row.content as string,
              metadata: {
                ...(row.metadata as Record<string, unknown>),
                meta_title: row.meta_title ?? undefined,
                section_path: row.section_path ?? undefined,
                chunk_index: row.chunk_index as number,
              } as Record<string, unknown>,
              similarity: row.similarity as number,
              representationType: 'canonical' as const,
            })),
          ),
      );
    }

    const repTypes = types.filter(
      (t): t is 'contextual_text' | 'sample_question' =>
        t === 'contextual_text' || t === 'sample_question',
    );

    for (const repType of repTypes) {
      subQueries.push(
        this.db
          .execute(
            sql`
              SELECT
                dc.id AS chunk_id,
                dc.source_id,
                dc.chunk_index,
                dc.content,
                dc.metadata,
                dc.meta_title,
                dc.section_path,
                1 - (r.embedding <=> ${vectorStr}::vector) AS similarity
              FROM document_chunk_representations r
              JOIN document_chunks dc ON dc.id = r.chunk_id
              WHERE r.representation_type = ${repType}
                AND r.embedding IS NOT NULL
                ${metaWhere}
              ORDER BY r.embedding <=> ${vectorStr}::vector
              LIMIT ${topK}
            `,
          )
          .then((rows) =>
            (rows as any[]).map((row) => ({
              chunkId: row.chunk_id as string,
              sourceId: row.source_id as string,
              content: row.content as string,
              metadata: {
                ...(row.metadata as Record<string, unknown>),
                meta_title: row.meta_title ?? undefined,
                section_path: row.section_path ?? undefined,
                chunk_index: row.chunk_index as number,
              } as Record<string, unknown>,
              similarity: row.similarity as number,
              representationType: repType,
            })),
          )
          .catch(() => [] as RepresentationHit[]),
      );
    }

    const settled = await Promise.allSettled(subQueries);
    const all: RepresentationHit[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        all.push(...result.value);
      }
    }
    return all;
  }
}
