import { Injectable, Logger } from '@nestjs/common';
import { RagChunkStoreService } from './rag-chunk-store.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { SparseSearchService, type SparseSearchFilters } from './sparse-search.service';
import { RetrievalFusionService, type RankedCandidate, type FusedCandidate } from './retrieval-fusion.service';

export interface OrchestrationRequest {
  rewrittenQuery: string;
  lanes: Array<'dense' | 'sparse' | 'graph'>;
  topKPerLane: number;
  filters: SparseSearchFilters;
  entityNames?: string[];
  rrfK?: number;
}

@Injectable()
export class RetrievalOrchestratorService {
  private readonly logger = new Logger(RetrievalOrchestratorService.name);

  constructor(
    private readonly chunkStore: RagChunkStoreService,
    private readonly sparseSearch: SparseSearchService,
    private readonly embeddingService: RagEmbeddingService,
    private readonly fusion: RetrievalFusionService,
  ) {}

  async orchestrate(request: OrchestrationRequest): Promise<FusedCandidate[]> {
    const { rewrittenQuery, lanes, topKPerLane, filters, rrfK = 60 } = request;

    const lanePromises: Array<Promise<RankedCandidate[]>> = [];

    if (lanes.includes('dense')) {
      lanePromises.push(this.runDenseLane(rewrittenQuery, topKPerLane, filters));
    }

    if (lanes.includes('sparse')) {
      lanePromises.push(this.runSparseLane(rewrittenQuery, topKPerLane, filters));
    }

    // Graph lane will be added in Phase 5

    const settled = await Promise.allSettled(lanePromises);
    const laneResults: RankedCandidate[][] = [];

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        laneResults.push(result.value);
      } else {
        this.logger.warn(`Lane failed: ${result.reason}`);
      }
    }

    return this.fusion.fuse(laneResults, rrfK);
  }

  private async runDenseLane(
    query: string,
    topK: number,
    filters: SparseSearchFilters,
  ): Promise<RankedCandidate[]> {
    const queryEmbedding = await this.embeddingService.embedQuery(query);
    const results = await this.chunkStore.search(queryEmbedding, {
      ...filters,
      limit: topK * 4,
    });

    return results.map((r) => ({
      chunkId: `${r.sourceId}-${r.chunkIndex}`,
      sourceId: r.sourceId,
      content: r.content,
      metadata: r.metadata,
      score: r.similarity,
      lane: 'dense' as const,
    }));
  }

  private async runSparseLane(
    query: string,
    topK: number,
    filters: SparseSearchFilters,
  ): Promise<RankedCandidate[]> {
    const results = await this.sparseSearch.search(query, filters, topK);
    return results.map((r) => ({
      chunkId: r.chunkId,
      sourceId: r.sourceId,
      content: r.content,
      metadata: r.metadata,
      score: r.score,
      lane: 'sparse' as const,
    }));
  }
}
