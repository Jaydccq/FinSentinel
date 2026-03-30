import { Module } from '@nestjs/common';
import { RagRetrievalService } from './rag-retrieval.service';

/**
 * RAG module -- Phase 8.
 *
 * Provides:
 * - RagRetrievalService — pgvector cosine similarity search with metadata filters
 *
 * The embedding pipeline (chunking, tokenization, embedding model) will be
 * wired in a future phase. Until then, search returns empty results.
 */
@Module({
  providers: [RagRetrievalService],
  exports: [RagRetrievalService],
})
export class RagModule {}
