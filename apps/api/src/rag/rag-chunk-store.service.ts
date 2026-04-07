import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, documentChunks, eq, sql } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';

export interface RagChunkRecord {
  sourceType: 'document' | 'news';
  sourceId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

interface RagChunkSearchFilters {
  docType?: string;
  sector?: string;
  regionId?: string;
  afterDate?: string;
  limit?: number;
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
    }>,
  ): Promise<void> {
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
        metaTitle: (chunk.metadata['title'] as string) ?? null,
        metaSource: (chunk.metadata['source'] as string) ?? null,
        metaEntities: null, // populated later by GraphEnrichmentConsumer
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
      sourceType: row.sourceType as 'document' | 'news',
      sourceId: row.sourceId,
      chunkIndex: row.chunkIndex,
      content: row.content,
      embedding: [],  // Don't load embeddings into memory anymore
      metadata: row.metadata,
      similarity: row.similarity,
    }));
  }
}
