import { Module, forwardRef } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { QueueModule } from '../queue/queue.module';
import { RagRetrievalService } from './rag-retrieval.service';
import { QueryRewriteService } from './query-rewrite.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagChunkStoreService } from './rag-chunk-store.service';
import { RagReindexService } from './rag-reindex.service';
import { RagBackfillSchedulerService } from './rag-backfill-scheduler.service';
import { SparseSearchService } from './sparse-search.service';
import { RetrievalFusionService } from './retrieval-fusion.service';
import { RetrievalOrchestratorService } from './retrieval-orchestrator.service';
import { RerankService } from './rerank.service';
import { ContextPackerService } from './context-packer.service';
import { RetrievalPlannerService } from './retrieval-planner.service';

/**
 * RAG module -- Phase 8.
 *
 * Provides:
 * - RagRetrievalService — pgvector cosine similarity search with metadata filters
 * - QueryRewriteService — LLM-powered query rewriting for better retrieval
 * - RagEmbeddingService / RagChunkStoreService — chunk storage + embedding persistence
 * - RagReindexService — backfill flow for documents/news that predate chunk storage
 * - RagBackfillSchedulerService — automatic background reindex for missing chunks
 */
@Module({
  imports: [CommonModule, forwardRef(() => QueueModule)],
  providers: [
    RagRetrievalService,
    QueryRewriteService,
    RagEmbeddingService,
    RagChunkStoreService,
    RagReindexService,
    RagBackfillSchedulerService,
    SparseSearchService,
    RetrievalFusionService,
    RetrievalOrchestratorService,
    RerankService,
    ContextPackerService,
    RetrievalPlannerService,
  ],
  exports: [
    RagRetrievalService,
    QueryRewriteService,
    RagEmbeddingService,
    RagChunkStoreService,
    RagReindexService,
    RagBackfillSchedulerService,
    SparseSearchService,
    RetrievalFusionService,
    RetrievalOrchestratorService,
    RerankService,
    ContextPackerService,
    RetrievalPlannerService,
  ],
})
export class RagModule {}
