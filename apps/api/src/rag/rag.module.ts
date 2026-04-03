import { Module } from '@nestjs/common';
import { RagRetrievalService } from './rag-retrieval.service';
import { QueryRewriteService } from './query-rewrite.service';
import { RagEmbeddingService } from './rag-embedding.service';
import { RagChunkStoreService } from './rag-chunk-store.service';
import { RagReindexService } from './rag-reindex.service';
import { RagBackfillSchedulerService } from './rag-backfill-scheduler.service';

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
  providers: [
    RagRetrievalService,
    QueryRewriteService,
    RagEmbeddingService,
    RagChunkStoreService,
    RagReindexService,
    RagBackfillSchedulerService,
  ],
  exports: [
    RagRetrievalService,
    QueryRewriteService,
    RagEmbeddingService,
    RagChunkStoreService,
    RagReindexService,
    RagBackfillSchedulerService,
  ],
})
export class RagModule {}
