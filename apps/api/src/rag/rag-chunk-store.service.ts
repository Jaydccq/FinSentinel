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

interface ChunkRow {
  id: string;
  sourceType: string;
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
      })),
    );
  }

  async search(
    queryEmbedding: number[],
    filters: RagChunkSearchFilters,
  ): Promise<Array<RagChunkRecord & { similarity: number }>> {
    const baseQuery = this.db
      .select({
        id: documentChunks.id,
        sourceType: documentChunks.sourceType,
        sourceId: documentChunks.sourceId,
        chunkIndex: documentChunks.chunkIndex,
        content: documentChunks.content,
        embedding: documentChunks.embedding,
        metadata: documentChunks.metadata,
      })
      .from(documentChunks);

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

    const query = clauses.length > 0
      ? baseQuery.where(sql.join(clauses, sql` AND `))
      : baseQuery;

    const rows: ChunkRow[] = await query.limit(filters.limit ?? 500);

    return rows
      .map((row) => ({
        sourceType: row.sourceType as 'document' | 'news',
        sourceId: row.sourceId,
        chunkIndex: row.chunkIndex,
        content: row.content,
        embedding: row.embedding,
        metadata: row.metadata,
        similarity: this.cosineSimilarity(queryEmbedding, row.embedding),
      }))
      .filter((row) => Number.isFinite(row.similarity))
      .sort((left, right) => right.similarity - left.similarity);
  }

  private cosineSimilarity(left: number[], right: number[]): number {
    if (left.length === 0 || right.length === 0 || left.length !== right.length) {
      return Number.NaN;
    }

    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;

    for (let index = 0; index < left.length; index++) {
      const l = left[index]!;
      const r = right[index]!;
      dot += l * r;
      leftNorm += l * l;
      rightNorm += r * r;
    }

    if (leftNorm === 0 || rightNorm === 0) {
      return Number.NaN;
    }

    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }
}
