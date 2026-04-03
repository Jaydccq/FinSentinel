import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagChunkStoreService } from './rag-chunk-store.service';
import { MetricsService } from '../common/services/metrics.service';

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

@Injectable()
export class RagRetrievalService {
  private readonly logger = new Logger(RagRetrievalService.name);
  private readonly similarityThreshold: number;

  constructor(
    private readonly embeddingService: RagEmbeddingService,
    private readonly chunkStore: RagChunkStoreService,
    private readonly metrics: MetricsService,
    configService: ConfigService,
  ) {
    this.similarityThreshold = configService.get<number>('RAG_SIMILARITY_THRESHOLD', 0.65);
  }

  async search(
    queryOrOptions: string | RagSearchOptions,
    topK?: number,
    docType?: string,
    sector?: string,
    regionId?: string,
    afterDate?: string,
  ): Promise<RagSearchResult[]> {
    const startedAt = Date.now();
    const opts: RagSearchOptions =
      typeof queryOrOptions === 'string'
        ? { query: queryOrOptions, topK, docType, sector, regionId, afterDate }
        : queryOrOptions;

    const safeTopK = Math.min(Math.max(opts.topK ?? 5, 1), 50);

    this.logger.debug(
      `RAG search: query="${opts.query.substring(0, 50)}..." topK=${safeTopK} ` +
      `docType=${opts.docType ?? 'any'} sector=${opts.sector ?? 'any'} ` +
      `region=${opts.regionId ?? 'any'} after=${opts.afterDate ?? 'any'}`,
    );

    try {
      const queryEmbedding = await this.embeddingService.embedQuery(opts.query);
      const ranked = await this.chunkStore.search(queryEmbedding, {
        docType: opts.docType,
        sector: opts.sector,
        regionId: opts.regionId,
        afterDate: opts.afterDate,
        limit: Math.max(safeTopK * 20, 200),
      });

      const results = ranked
        .filter((row) => row.similarity >= this.similarityThreshold)
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, safeTopK)
        .map((row) => ({
          content: row.content,
          metadata: row.metadata,
          similarity: row.similarity,
        }));

      this.metrics.incrementCounter(
        'rag_search_requests_total',
        'Total RAG search requests by status',
        { status: 'success' },
      );
      this.metrics.incrementCounter(
        'rag_search_results_total',
        'Total RAG search results returned after threshold filtering',
        {},
        results.length,
      );
      this.metrics.setGauge(
        'rag_search_last_duration_ms',
        'Duration in milliseconds of the most recent RAG search',
        { status: 'success' },
        Date.now() - startedAt,
      );
      this.metrics.setGauge(
        'rag_search_last_result_count',
        'Result count of the most recent RAG search',
        {},
        results.length,
      );

      return results;
    } catch (error) {
      this.metrics.incrementCounter(
        'rag_search_requests_total',
        'Total RAG search requests by status',
        { status: 'error' },
      );
      this.metrics.setGauge(
        'rag_search_last_duration_ms',
        'Duration in milliseconds of the most recent RAG search',
        { status: 'error' },
        Date.now() - startedAt,
      );
      throw error;
    }
  }

  getThreshold(): number {
    return this.similarityThreshold;
  }
}
