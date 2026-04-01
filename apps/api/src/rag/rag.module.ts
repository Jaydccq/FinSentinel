import { Module } from '@nestjs/common';
import { RagRetrievalService } from './rag-retrieval.service';
import { QueryRewriteService } from './query-rewrite.service';

/**
 * RAG module -- Phase 8.
 *
 * Provides:
 * - RagRetrievalService — pgvector cosine similarity search with metadata filters
 * - QueryRewriteService — LLM-powered query rewriting for better retrieval
 *
 * The embedding pipeline (chunking, tokenization, embedding model) will be
 * wired in a future phase. Until then, search returns empty results.
 */
@Module({
  providers: [RagRetrievalService, QueryRewriteService],
  exports: [RagRetrievalService, QueryRewriteService],
})
export class RagModule {}
