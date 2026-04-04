import { Inject, Injectable } from '@nestjs/common';
import { and, documentChunks, documents, eq, inArray, isNotNull, newsItems } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { VectorizeProducer } from '../queue/vectorize.producer';
import { NewsEnrichProducer } from '../queue/news-enrich.producer';

export interface ReindexResult {
  queued: number;
  ids: string[];
}

@Injectable()
export class RagReindexService {
  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly vectorizeProducer: VectorizeProducer,
    private readonly newsEnrichProducer: NewsEnrichProducer,
  ) {}

  async reindexDocumentById(userId: string, documentId: string): Promise<ReindexResult> {
    const docs = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
      .limit(1);

    if (docs.length === 0) {
      return { queued: 0, ids: [] };
    }

    await this.vectorizeProducer.send(documentId);
    return { queued: 1, ids: [documentId] };
  }

  async reindexMissingDocuments(
    limit = 100,
    force = false,
  ): Promise<ReindexResult> {
    return this.reindexDocuments(limit, force);
  }

  async reindexMissingDocumentsForUser(
    userId: string,
    limit = 100,
    force = false,
  ): Promise<ReindexResult> {
    return this.reindexDocuments(limit, force, userId);
  }

  private async reindexDocuments(
    limit: number,
    force: boolean,
    userId?: string,
  ): Promise<ReindexResult> {
    const conditions = [isNotNull(documents.storageKey)];
    if (userId) {
      conditions.push(eq(documents.userId, userId));
    }

    const docs = await this.db
      .select({
        id: documents.id,
        status: documents.status,
        storageKey: documents.storageKey,
      })
      .from(documents)
      .where(and(...conditions))
      .limit(Math.max(limit * 3, limit));

    const eligible = docs.filter((doc: { status: string | null }) => doc.status !== 'EMPTY');
    const missingIds = force
      ? eligible.map((doc: { id: string }) => doc.id)
      : await this.filterIdsWithoutChunks(
          'document',
          eligible.map((doc: { id: string }) => doc.id),
        );

    const ids = missingIds.slice(0, limit);
    for (const id of ids) {
      await this.vectorizeProducer.send(id);
    }

    return { queued: ids.length, ids };
  }

  async reindexMissingNews(limit = 100, force = false): Promise<ReindexResult> {
    const items = await this.db
      .select({
        id: newsItems.id,
        articleUrl: newsItems.articleUrl,
        enriched: newsItems.enriched,
      })
      .from(newsItems)
      .where(isNotNull(newsItems.articleUrl))
      .limit(Math.max(limit * 3, limit));

    const eligible = items.filter(
      (item: { articleUrl: string | null }) => typeof item.articleUrl === 'string' && item.articleUrl.length > 0,
    );

    const missingIds = force
      ? eligible.map((item: { id: string }) => item.id)
      : await this.filterIdsWithoutChunks(
          'news',
          eligible.map((item: { id: string }) => item.id),
        );

    const ids = missingIds.slice(0, limit);
    for (const id of ids) {
      await this.newsEnrichProducer.send(id);
    }

    return { queued: ids.length, ids };
  }

  private async filterIdsWithoutChunks(
    sourceType: 'document' | 'news',
    ids: string[],
  ): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }

    const chunkRows = await this.db
      .select({ sourceId: documentChunks.sourceId })
      .from(documentChunks)
      .where(
        and(
          eq(documentChunks.sourceType, sourceType),
          inArray(documentChunks.sourceId, ids),
        ),
      );

    const existing = new Set(
      chunkRows.map((row: { sourceId: string }) => row.sourceId),
    );

    return ids.filter((id) => !existing.has(id));
  }
}
