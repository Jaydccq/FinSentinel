import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagChunkStoreService } from './rag-chunk-store.service';
import { MetricsService } from '../common/services/metrics.service';
import { RetrievalPlannerService } from './retrieval-planner.service';
import { RetrievalOrchestratorService } from './retrieval-orchestrator.service';
import { RerankService } from './rerank.service';
import { ContextPackerService } from './context-packer.service';
import { ContextExpanderService } from './context-expander.service';

export interface RagSearchResult {
  chunkId: string;
  sourceId: string;
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
  private readonly multiStageEnabled: boolean;

  constructor(
    private readonly embeddingService: RagEmbeddingService,
    private readonly chunkStore: RagChunkStoreService,
    private readonly metrics: MetricsService,
    configService: ConfigService,
    @Optional() private readonly planner?: RetrievalPlannerService,
    @Optional() private readonly orchestrator?: RetrievalOrchestratorService,
    @Optional() private readonly reranker?: RerankService,
    @Optional() private readonly contextPacker?: ContextPackerService,
    @Optional() private readonly contextExpander?: ContextExpanderService,
  ) {
    this.similarityThreshold = configService.get<number>('RAG_SIMILARITY_THRESHOLD', 0.65);
    this.multiStageEnabled = configService.get<string>('RAG_MULTI_STAGE_ENABLED', 'false') === 'true';
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

    // Delegate to multi-stage pipeline when enabled and all services are available
    if (this.multiStageEnabled && this.planner && this.orchestrator && this.reranker && this.contextPacker) {
      return this.searchMultiStage(opts, safeTopK);
    }

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
          chunkId: row.id,
          sourceId: row.sourceId,
          content: row.content,
          metadata: row.metadata,
          similarity: row.similarity,
        }));

      const durationSecs = (Date.now() - startedAt) / 1000;
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
      this.metrics.observeHistogram(
        'rag_search_duration_seconds',
        'Duration of RAG search operations in seconds',
        { status: 'success' },
        durationSecs,
        [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      );
      this.metrics.setGauge(
        'rag_search_last_result_count',
        'Result count of the most recent RAG search',
        {},
        results.length,
      );

      return results;
    } catch (error) {
      const durationSecs = (Date.now() - startedAt) / 1000;
      this.metrics.incrementCounter(
        'rag_search_requests_total',
        'Total RAG search requests by status',
        { status: 'error' },
      );
      this.metrics.observeHistogram(
        'rag_search_duration_seconds',
        'Duration of RAG search operations in seconds',
        { status: 'error' },
        durationSecs,
        [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      );
      throw error;
    }
  }

  private async searchMultiStage(
    opts: RagSearchOptions,
    safeTopK: number,
  ): Promise<RagSearchResult[]> {
    const startedAt = Date.now();
    try {
      const plan = await this.planner!.plan(opts.query);
      const fused = await this.orchestrator!.orchestrate({
        rewrittenQuery: plan.rewrittenQuery,
        lanes: plan.lanes,
        topKPerLane: plan.topKPerLane,
        filters: {
          docType: opts.docType,
          sector: opts.sector,
          regionId: opts.regionId,
          afterDate: opts.afterDate,
        },
      });
      const reranked = await this.reranker!.rerank(plan.rewrittenQuery, fused, safeTopK * 2);
      const expanded = this.contextExpander
        ? await this.contextExpander.expand(reranked, { neighborChunks: 1, fetchParentSection: true })
        : reranked;
      const packed = this.contextPacker!.pack(expanded, {
        maxTokens: 4096,
        maxChunksPerSource: 3,
      });

      const results = packed.chunks.slice(0, safeTopK).map((c) => ({
        chunkId: c.chunkId,
        sourceId: c.sourceId,
        content: c.content,
        metadata: c.metadata,
        similarity: 1.0, // reranked results don't have cosine similarity
      }));

      this.metrics.incrementCounter('rag_search_requests_total', 'Total RAG search requests by status', { status: 'success' });
      this.metrics.observeHistogram(
        'rag_search_duration_seconds',
        'Duration of RAG search operations in seconds',
        { status: 'success' },
        (Date.now() - startedAt) / 1000,
        [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      );
      return results;
    } catch (error) {
      this.logger.warn(`Multi-stage search failed, falling back to dense: ${error}`);
      this.metrics.incrementCounter('rag_search_requests_total', 'Total RAG search requests by status', { status: 'error' });
      this.metrics.observeHistogram(
        'rag_search_duration_seconds',
        'Duration of RAG search operations in seconds',
        { status: 'error' },
        (Date.now() - startedAt) / 1000,
        [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      );
      // Fall back to single-stage dense search
      return this.searchDenseFallback(opts, safeTopK);
    }
  }

  private async searchDenseFallback(opts: RagSearchOptions, safeTopK: number): Promise<RagSearchResult[]> {
    const queryEmbedding = await this.embeddingService.embedQuery(opts.query);
    const ranked = await this.chunkStore.search(queryEmbedding, {
      docType: opts.docType,
      sector: opts.sector,
      regionId: opts.regionId,
      afterDate: opts.afterDate,
      limit: Math.max(safeTopK * 20, 200),
    });
    return ranked
      .filter((row) => row.similarity >= this.similarityThreshold)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, safeTopK)
      .map((row) => ({ chunkId: row.id, sourceId: row.sourceId, content: row.content, metadata: row.metadata, similarity: row.similarity }));
  }

  getThreshold(): number {
    return this.similarityThreshold;
  }
}
