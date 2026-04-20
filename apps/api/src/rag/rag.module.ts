import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { QueryVariantService } from './query-variant.service';
import { GraphRetrievalService } from './graph-retrieval.service';
import { GoldenCandidatesService, GOLDEN_LLM_CLIENT } from './eval/golden-candidates.service';
import { ChunkRepresentationService, REPRESENTATION_LLM_CLIENT } from './chunk-representation.service';
import { RepresentationAdminService } from './admin/representation-admin.service';
import { MetadataPreFilterService } from './metadata-pre-filter.service';
import { ContextExpanderService } from './context-expander.service';
import { RagTraceService } from './rag-trace.service';
import { RagTraceRetentionService } from './rag-trace-retention.service';
import { createOpenRouterModel, generateAgentText } from '@finsentinel/ai-runtime';
import { ConfigType } from '@nestjs/config';
import { aiConfig } from '../config/ai.config';
import type { LlmTextClient } from './eval/golden-candidates.service';

/**
 * RAG module -- Phase 8.
 *
 * Provides:
 * - RagRetrievalService — pgvector cosine similarity search with metadata filters
 * - QueryRewriteService — LLM-powered query rewriting for better retrieval
 * - RagEmbeddingService / RagChunkStoreService — chunk storage + embedding persistence
 * - RagReindexService — backfill flow for documents/news that predate chunk storage
 * - RagBackfillSchedulerService — automatic background reindex for missing chunks
 * - GoldenCandidatesService — golden-set candidate export for RAG evaluation (T1.C)
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
    {
      // SparseSearchService receives ConfigService so `RAG_SPARSE_WEIGHTS`
      // env-var-driven weight vector actually propagates to production.
      // Without this factory Nest constructs the service with only DRIZZLE_DB
      // and the optional second arg stays undefined, so the env knob would be
      // decorative. See sparse-search.service.ts for the typed constructor.
      provide: SparseSearchService,
      useFactory: (db: unknown, config: ConfigService) => {
        return new SparseSearchService(db as never, config);
      },
      inject: ['DRIZZLE_DB', ConfigService],
    },
    RetrievalFusionService,
    RetrievalOrchestratorService,
    RerankService,
    ContextPackerService,
    RetrievalPlannerService,
    QueryVariantService,
    GraphRetrievalService,
    GoldenCandidatesService,
    {
      provide: GOLDEN_LLM_CLIENT,
      useFactory: (aiCfg: ConfigType<typeof aiConfig>): LlmTextClient => {
        const model = createOpenRouterModel({
          modelId: aiCfg.model,
          baseUrl: aiCfg.openrouterBaseUrl,
        });
        return {
          async generate(systemPrompt: string, userPrompt: string): Promise<string> {
            return generateAgentText({ model, systemPrompt, prompt: userPrompt, tools: {} });
          },
        };
      },
      inject: [aiConfig.KEY],
    },
    ChunkRepresentationService,
    RepresentationAdminService,
    {
      provide: REPRESENTATION_LLM_CLIENT,
      useFactory: (aiCfg: ConfigType<typeof aiConfig>): LlmTextClient => {
        const model = createOpenRouterModel({
          modelId: aiCfg.model,
          baseUrl: aiCfg.openrouterBaseUrl,
        });
        return {
          async generate(systemPrompt: string, userPrompt: string): Promise<string> {
            return generateAgentText({ model, systemPrompt, prompt: userPrompt, tools: {} });
          },
        };
      },
      inject: [aiConfig.KEY],
    },
    {
      // Default config — R4.4 replaces this factory with a ConfigService-backed version.
      provide: MetadataPreFilterService,
      useFactory: () => new MetadataPreFilterService({
        mode: 'soft',
        hardMinConfidence: 0.85,
        minCandidatesByClass: {},
      }),
    },
    ContextExpanderService,
    RagTraceService,
    RagTraceRetentionService,
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
    QueryVariantService,
    GraphRetrievalService,
    GoldenCandidatesService,
    ChunkRepresentationService,
    RepresentationAdminService,
    MetadataPreFilterService,
    ContextExpanderService,
    RagTraceService,
    RagTraceRetentionService,
  ],
})
export class RagModule {}
