import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommonModule } from '../common/common.module';
import { QueueModule } from '../queue/queue.module';
import { ParserSidecarClient } from '../document/parser-sidecar.client';
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
import { QueryEntityExtractorService, METADATA_ENTITY_LLM_CLIENT } from './query-entity-extractor.service';
import { ContextExpanderService } from './context-expander.service';
import { RagTraceService } from './rag-trace.service';
import { RagTraceRetentionService } from './rag-trace-retention.service';
import { RolloutGateService } from './rollout-gate.service';
import { ShadowRunnerService } from './shadow-runner.service';
import { createOpenAICompatibleModel, generateAgentText } from '@finsentinel/ai-runtime';
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
        const model = createOpenAICompatibleModel({
          provider: aiCfg.provider ?? 'openrouter',
          modelId: aiCfg.model,
          baseUrl: aiCfg.baseUrl ?? aiCfg.openrouterBaseUrl,
        });
        return {
          async generate(systemPrompt: string, userPrompt: string): Promise<string> {
            return generateAgentText({
              model,
              apiKey: aiCfg.apiKey ?? aiCfg.openrouterApiKey,
              systemPrompt,
              prompt: userPrompt,
              tools: {},
            });
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
        const model = createOpenAICompatibleModel({
          provider: aiCfg.provider ?? 'openrouter',
          modelId: aiCfg.model,
          baseUrl: aiCfg.baseUrl ?? aiCfg.openrouterBaseUrl,
        });
        return {
          async generate(systemPrompt: string, userPrompt: string): Promise<string> {
            return generateAgentText({
              model,
              apiKey: aiCfg.apiKey ?? aiCfg.openrouterApiKey,
              systemPrompt,
              prompt: userPrompt,
              tools: {},
            });
          },
        };
      },
      inject: [aiConfig.KEY],
    },
    {
      provide: MetadataPreFilterService,
      useFactory: (configService: ConfigService) => new MetadataPreFilterService({
        mode: configService.get<'off' | 'soft' | 'hard'>('rag.metadataPrefilter.mode', 'soft'),
        hardMinConfidence: configService.get<number>('rag.metadataPrefilter.hardMinConfidence', 0.85),
        minCandidatesByClass: configService.get<Record<string, number>>('rag.metadataPrefilter.minCandidatesByClass', {}),
      }),
      inject: [ConfigService],
    },
    {
      provide: METADATA_ENTITY_LLM_CLIENT,
      useFactory: (aiCfg: ConfigType<typeof aiConfig>) => {
        const model = createOpenAICompatibleModel({
          provider: aiCfg.provider ?? 'openrouter',
          modelId: aiCfg.model,
          baseUrl: aiCfg.baseUrl ?? aiCfg.openrouterBaseUrl,
        });
        return {
          async complete(prompt: string): Promise<string> {
            return generateAgentText({
              model,
              apiKey: aiCfg.apiKey ?? aiCfg.openrouterApiKey,
              systemPrompt: '',
              prompt,
              tools: {},
            });
          },
        };
      },
      inject: [aiConfig.KEY],
    },
    {
      provide: QueryEntityExtractorService,
      useFactory: (
        configService: ConfigService,
        llmClient: { complete: (prompt: string) => Promise<string> },
      ) => new QueryEntityExtractorService({
        llmFallbackEnabled: configService.get<boolean>('rag.metadataPrefilter.llmFallbackEnabled', false),
        llmClient: configService.get<boolean>('rag.metadataPrefilter.llmFallbackEnabled', false)
          ? llmClient
          : null,
        hardMinConfidence: configService.get<number>('rag.metadataPrefilter.hardMinConfidence', 0.85),
        timeoutMs: configService.get<number>('rag.metadataPrefilter.llmTimeoutMs', 1500),
        concurrency: configService.get<number>('rag.metadataPrefilter.llmConcurrency', 4),
      }),
      inject: [ConfigService, METADATA_ENTITY_LLM_CLIENT],
    },
    {
      provide: RolloutGateService,
      useFactory: (configService: ConfigService) => new RolloutGateService({
        percentByClass: configService.get<Record<string, number>>('rag.rollout.canaryPercentByClass', {}),
        anonMultiplier: configService.get<number>('rag.rollout.anonMultiplier', 0.5),
      }),
      inject: [ConfigService],
    },
    {
      provide: ShadowRunnerService,
      useFactory: (configService: ConfigService) => new ShadowRunnerService({
        concurrency: configService.get<number>('rag.rollout.shadowConcurrency', 4),
        maxQueueDepth: configService.get<number>('rag.rollout.shadowMaxQueueDepth', 200),
        timeoutMs: configService.get<number>('rag.rollout.shadowTimeoutMs', 2000),
      }),
      inject: [ConfigService],
    },
    ContextExpanderService,
    RagTraceService,
    RagTraceRetentionService,
    {
      provide: 'PARSER_SIDECAR_CONFIG',
      useFactory: (configService: ConfigService) => ({
        url: configService.get<string>('rag.parser.url', 'http://localhost:8110'),
        timeoutMs: configService.get<number>('rag.parser.timeoutMs', 30_000),
        minMarkdownChars: configService.get<number>('rag.parser.minMarkdownChars', 50),
      }),
      inject: [ConfigService],
    },
    ParserSidecarClient,
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
    QueryEntityExtractorService,
    RolloutGateService,
    ShadowRunnerService,
    ContextExpanderService,
    RagTraceService,
    RagTraceRetentionService,
    ParserSidecarClient,
  ],
})
export class RagModule {}
