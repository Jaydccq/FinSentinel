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
import { RagTraceService } from './rag-trace.service';

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
    @Optional() private readonly ragTrace?: RagTraceService,
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
    const timingsMs: Record<string, number> = {};
    const fallbackFlags: string[] = [];
    let rerankReason: string | null = null;
    let resultChunkIds: string[] = [];
    let planLanes: string[] = [];
    let planVariants: Array<{ kind: string; query: string }> = [];
    let planQueryClass: string | undefined;
    let planFallbackFlags: string[] = [];

    try {
      const planStart = Date.now();
      const plan = await this.planner!.plan(opts.query);
      timingsMs['plan'] = Date.now() - planStart;
      planLanes = plan.lanes;
      planVariants = plan.variants ?? [];
      planQueryClass = plan.queryClass;
      planFallbackFlags = plan.fallbackFlags ?? [];

      const orchestrateStart = Date.now();
      const filters = {
        docType: opts.docType,
        sector: opts.sector,
        regionId: opts.regionId,
        afterDate: opts.afterDate,
      };
      const { fused, laneCounts } = await this.orchestrator!.orchestrate({
        rewrittenQuery: plan.rewrittenQuery,
        lanes: plan.lanes,
        topKPerLane: plan.topKPerLane,
        filters,
        variants: plan.variants,
        queryClass: plan.queryClass,
      });
      timingsMs['orchestrate'] = Date.now() - orchestrateStart;

      const rerankStart = Date.now();
      const reranked = await this.reranker!.rerank(plan.rewrittenQuery, fused, safeTopK * 2);
      timingsMs['rerank'] = Date.now() - rerankStart;

      // Collect rerank fallback reason from first result (all share same reason when fallback fires).
      rerankReason = reranked[0]?.fallbackReason ?? null;
      if (rerankReason) {
        fallbackFlags.push(rerankReason);
      }

      const expandStart = Date.now();
      const expanded = this.contextExpander
        ? await this.contextExpander.expand(reranked, { neighborChunks: 1, fetchParentSection: true })
        : reranked;
      timingsMs['expand'] = Date.now() - expandStart;

      const packed = this.contextPacker!.pack(expanded, {
        maxTokens: 4096,
        maxChunksPerSource: 3,
      });

      const topPackedChunks = packed.chunks.slice(0, safeTopK);
      const results = topPackedChunks.map((c) => ({
        chunkId: c.chunkId,
        sourceId: c.sourceId,
        content: c.content,
        metadata: c.metadata,
        similarity: 1.0, // reranked results don't have cosine similarity
      }));

      resultChunkIds = results.map((r) => r.chunkId);

      // Aggregate representationTypesSeen across the top-K packed chunks.
      // We union over the fused candidates whose chunkId appears in the
      // packed output so provenance survives through the full pipeline.
      const packedChunkIdSet = new Set(resultChunkIds);
      const repsSet = new Set<string>();
      for (const candidate of fused) {
        if (packedChunkIdSet.has(candidate.chunkId)) {
          for (const rt of candidate.representationTypesSeen) {
            repsSet.add(rt);
          }
        }
      }
      const representationTypesSeen = [...repsSet];

      const totalMs = Date.now() - startedAt;

      this.metrics.incrementCounter('rag_search_requests_total', 'Total RAG search requests by status', { status: 'success' });
      this.metrics.observeHistogram(
        'rag_search_duration_seconds',
        'Duration of RAG search operations in seconds',
        { status: 'success' },
        totalMs / 1000,
        [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      );

      this.fireTrace({
        query: opts.query,
        queryClass: planQueryClass,
        variants: planVariants,
        filters: { docType: opts.docType ?? null, sector: opts.sector ?? null, regionId: opts.regionId ?? null, afterDate: opts.afterDate ?? null },
        lanes: planLanes,
        resultChunkIds,
        laneCounts,
        representationTypesSeen,
        timingsMs,
        fallbackFlags: [...planFallbackFlags, ...fallbackFlags],
        rerankReason,
        totalMs,
      });

      return results;
    } catch (error) {
      this.logger.warn(`Multi-stage search failed, falling back to dense: ${error}`);
      const totalMs = Date.now() - startedAt;
      this.metrics.incrementCounter('rag_search_requests_total', 'Total RAG search requests by status', { status: 'error' });
      this.metrics.observeHistogram(
        'rag_search_duration_seconds',
        'Duration of RAG search operations in seconds',
        { status: 'error' },
        totalMs / 1000,
        [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      );

      this.fireTrace({
        query: opts.query,
        queryClass: planQueryClass,
        variants: planVariants,
        filters: { docType: opts.docType ?? null, sector: opts.sector ?? null, regionId: opts.regionId ?? null, afterDate: opts.afterDate ?? null },
        lanes: planLanes,
        resultChunkIds,
        laneCounts: {},
        timingsMs,
        fallbackFlags: [...planFallbackFlags, 'multi_stage_error'],
        rerankReason,
        totalMs,
      });

      // Fall back to single-stage dense search
      return this.searchDenseFallback(opts, safeTopK);
    }
  }

  private fireTrace(input: Parameters<RagTraceService['recordTrace']>[0]): void {
    if (!this.ragTrace) return;
    this.ragTrace.recordTrace(input).catch((err: unknown) => {
      this.logger.warn(`RagTraceService.recordTrace unhandled rejection: ${err}`);
    });
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
