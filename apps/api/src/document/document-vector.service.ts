import { Injectable, Logger } from '@nestjs/common';
import { DocumentChunkingService } from './document-chunking.service';
import { RagEmbeddingService } from '../rag/rag-embedding.service';
import { RagChunkStoreService } from '../rag/rag-chunk-store.service';
import { MetricsService } from '../common/services/metrics.service';

/**
 * Document vectorization service -- embeds text chunks into pgvector.
 *
 * Pipeline: text -> chunk -> embed each chunk -> persist into document_chunks.
 *
 * Each chunk is stored with metadata: doc_type, sector, region_id, source, date.
 * Embeddings are generated through the configured OpenAI-compatible provider
 * and stored for later cosine-similarity retrieval.
 */
@Injectable()
export class DocumentVectorService {
  private readonly logger = new Logger(DocumentVectorService.name);

  constructor(
    private readonly chunking: DocumentChunkingService,
    private readonly embeddingService: RagEmbeddingService,
    private readonly ragChunkStore: RagChunkStoreService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Vectorize a document: chunk the text, embed, and store in pgvector.
   *
   * @param docId - UUID of the source document
   * @param text - Cleaned plain text to vectorize
   * @param metadata - Metadata to attach to each chunk (doc_type, sector, region_id, source, date)
   * @returns Number of chunks created
   */
  async vectorize(
    docId: string,
    text: string,
    metadata: Record<string, string>,
  ): Promise<number> {
    const sourceType = metadata['doc_type'] === 'NEWS' ? 'news' : 'document';
    const startedAt = Date.now();

    if (!text || text.trim().length === 0) {
      this.logger.warn(`Empty text for document ${docId}, skipping vectorization`);
      this.recordVectorizationMetrics(sourceType, 'empty', startedAt, 0);
      return 0;
    }

    const chunks = this.chunking.chunk(text);

    if (chunks.length === 0) {
      this.logger.warn(
        `No chunks produced for document ${docId} (text may be too short)`,
      );
      this.recordVectorizationMetrics(sourceType, 'empty', startedAt, 0);
      return 0;
    }

    this.logger.log(
      `Vectorizing document ${docId}: ${chunks.length} chunks, ` +
      `metadata=${JSON.stringify(metadata)}`,
    );

    try {
      const embeddings = await this.embeddingService.embedChunks(chunks);
      if (embeddings.length !== chunks.length) {
        throw new Error(
          `Embedding count mismatch for ${docId}: expected ${chunks.length}, got ${embeddings.length}`,
        );
      }

      await this.ragChunkStore.replaceChunks(
        sourceType,
        docId,
        chunks.map((chunk, index) => ({
          content: chunk,
          embedding: embeddings[index]!,
          metadata: {
            ...metadata,
            source_type: sourceType,
            source_id: docId,
            chunk_index: index,
          },
        })),
      );

      this.recordVectorizationMetrics(sourceType, 'success', startedAt, chunks.length);
      return chunks.length;
    } catch (error) {
      this.recordVectorizationMetrics(sourceType, 'error', startedAt, 0);
      throw error;
    }
  }

  private recordVectorizationMetrics(
    sourceType: 'document' | 'news',
    status: 'success' | 'error' | 'empty',
    startedAt: number,
    chunkCount: number,
  ): void {
    this.metrics.incrementCounter(
      'rag_vectorizations_total',
      'Total vectorization attempts by source type and status',
      { source_type: sourceType, status },
    );
    this.metrics.setGauge(
      'rag_vectorization_last_duration_ms',
      'Duration in milliseconds of the most recent vectorization attempt',
      { source_type: sourceType, status },
      Date.now() - startedAt,
    );

    if (chunkCount > 0) {
      this.metrics.incrementCounter(
        'rag_vectorized_chunks_total',
        'Total number of chunks stored through vectorization',
        { source_type: sourceType },
        chunkCount,
      );
      this.metrics.setGauge(
        'rag_vectorization_last_chunk_count',
        'Chunk count produced by the most recent successful vectorization',
        { source_type: sourceType },
        chunkCount,
      );
    }
  }
}
