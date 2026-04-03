import { Inject, Injectable } from '@nestjs/common';
import { desc, documents, newsItems, sql } from '@finsentinel/db';
import { OnDemandNewsService } from '../news/on-demand-news.service';
import { RagRetrievalService } from '../rag/rag-retrieval.service';

interface RecentNewsRow {
  title: string;
  summary: string | null;
  articleUrl: string | null;
  source: string;
  author: string | null;
  publishedAt: Date | string;
}

interface KnowledgeBaseDocumentRow {
  id: string;
  originalFileName: string;
  docType: string;
  sector: string | null;
  regionId: string | null;
  createdAt: Date | null;
}

@Injectable()
export class NewsAnalysisService {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
    private readonly onDemandNewsService: OnDemandNewsService,
    private readonly ragRetrievalService: RagRetrievalService,
  ) {}

  async getRecentNews(ticker: string, days: number): Promise<string> {
    const upperTicker = ticker.toUpperCase().trim();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const tickerWhere =
      sql`${newsItems.tickers}::jsonb @> ${JSON.stringify([upperTicker])}::jsonb`;

    let rows: RecentNewsRow[] = await this.db
      .select({
        title: newsItems.title,
        summary: newsItems.summary,
        articleUrl: newsItems.articleUrl,
        source: newsItems.source,
        author: newsItems.author,
        publishedAt: newsItems.publishedAt,
      })
      .from(newsItems)
      .where(sql`${tickerWhere} AND ${newsItems.publishedAt} >= ${cutoff}`)
      .orderBy(desc(newsItems.publishedAt))
      .limit(8);

    if (rows.length === 0) {
      await this.onDemandNewsService.fetchForTickers([upperTicker]);
      rows = await this.db
        .select({
          title: newsItems.title,
          summary: newsItems.summary,
          articleUrl: newsItems.articleUrl,
          source: newsItems.source,
          author: newsItems.author,
          publishedAt: newsItems.publishedAt,
        })
        .from(newsItems)
        .where(sql`${tickerWhere} AND ${newsItems.publishedAt} >= ${cutoff}`)
        .orderBy(desc(newsItems.publishedAt))
        .limit(8);
    }

    if (rows.length === 0) {
      return `No recent news found for ${upperTicker} in the last ${days} day(s).`;
    }

    return rows
      .map((row: RecentNewsRow, index: number) => {
        const parts = [
          `${index + 1}. [${row.source}] ${row.title}`,
          `Published: ${row.publishedAt instanceof Date ? row.publishedAt.toISOString() : String(row.publishedAt)}`,
        ];

        if (row.author) {
          parts.push(`Author: ${row.author}`);
        }
        if (row.summary) {
          parts.push(`Summary: ${row.summary}`);
        }
        if (row.articleUrl) {
          parts.push(`URL: ${row.articleUrl}`);
        }

        return parts.join('\n');
      })
      .join('\n\n');
  }

  async searchKnowledgeBase(
    query: string,
    docType?: string,
    afterDate?: string,
  ): Promise<string> {
    const results = await this.ragRetrievalService.search({
      query,
      topK: 8,
      docType,
      afterDate,
    });

    if (results.length > 0) {
      return results
        .map((result, index) => {
          const metadata = result.metadata;
          const title =
            this.readMetadata(metadata, 'title') ??
            this.readMetadata(metadata, 'fileName') ??
            this.readMetadata(metadata, 'source') ??
            'Untitled result';

          const similarityPct = `${(result.similarity * 100).toFixed(1)}%`;
          return [
            `${index + 1}. ${title} (${similarityPct} match)`,
            `Content: ${result.content}`,
            `Metadata: ${JSON.stringify(metadata)}`,
          ].join('\n');
        })
        .join('\n\n');
    }

    const baseQuery = this.db
      .select({
        id: documents.id,
        originalFileName: documents.originalFileName,
        docType: documents.docType,
        sector: documents.sector,
        regionId: documents.regionId,
        createdAt: documents.createdAt,
      })
      .from(documents);

    const fallbackDocs: KnowledgeBaseDocumentRow[] = await (docType
      ? baseQuery.where(sql`${documents.docType} = ${docType}`)
      : baseQuery)
      .orderBy(desc(documents.createdAt))
      .limit(5);

    const filteredDocs = fallbackDocs.filter((doc: KnowledgeBaseDocumentRow) => {
      if (afterDate && doc.createdAt && doc.createdAt < new Date(afterDate)) {
        return false;
      }
      return this.matchesKeyword([doc.originalFileName, doc.docType, doc.sector], query);
    });

    if (filteredDocs.length === 0) {
      return `No knowledge-base results found for "${query}".`;
    }

    return filteredDocs
      .map((doc: KnowledgeBaseDocumentRow, index: number) =>
        [
          `${index + 1}. ${doc.originalFileName}`,
          `Type: ${doc.docType}`,
          `Sector: ${doc.sector ?? 'N/A'}`,
          `Region: ${doc.regionId ?? 'N/A'}`,
          `Created: ${doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt)}`,
        ].join('\n'),
      )
      .join('\n\n');
  }

  private readMetadata(
    metadata: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = metadata[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private matchesKeyword(values: Array<string | null | undefined>, query: string): boolean {
    const normalizedQuery = query.trim().toLowerCase();
    return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
  }
}
