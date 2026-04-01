import { Injectable, Logger, Inject } from '@nestjs/common';
import { DocumentChunkingService } from './document-chunking.service';

/**
 * Document vectorization service -- embeds text chunks into pgvector.
 *
 * Pipeline: text -> chunk -> embed each chunk -> INSERT into document_chunks table.
 *
 * Each chunk is stored with metadata: doc_type, sector, region_id, source, date.
 * Embedding uses AI SDK `embedMany` (to be wired when embedding model is configured).
 *
 * For now, this service chunks the text and logs a placeholder for the actual
 * embedding + INSERT step, returning the chunk count.
 */
@Injectable()
export class DocumentVectorService {
  private readonly logger = new Logger(DocumentVectorService.name);

  constructor(
    private readonly chunking: DocumentChunkingService,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
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
    if (!text || text.trim().length === 0) {
      this.logger.warn(`Empty text for document ${docId}, skipping vectorization`);
      return 0;
    }

    const chunks = this.chunking.chunk(text);

    if (chunks.length === 0) {
      this.logger.warn(
        `No chunks produced for document ${docId} (text may be too short)`,
      );
      return 0;
    }

    this.logger.log(
      `Vectorizing document ${docId}: ${chunks.length} chunks, ` +
      `metadata=${JSON.stringify(metadata)}`,
    );

    // TODO: Wire actual embedding + pgvector INSERT when embedding model is configured.
    //
    // Implementation outline:
    // 1. const { embeddings } = await embedMany({ model, values: chunks });
    // 2. For each chunk + embedding:
    //    INSERT INTO document_chunks (id, document_id, content, embedding, metadata, created_at)
    //    VALUES (gen_random_uuid(), $docId, $chunk, $embedding::vector, $metadata::jsonb, now())
    // 3. Update documents SET chunk_count = chunks.length, status = 'VECTORIZED'
    //
    // Batch insert for efficiency (chunks can be 100s-1000s per document).

    this.logger.debug(
      `[STUB] Would embed ${chunks.length} chunks for document ${docId} ` +
      `and INSERT into document_chunks table`,
    );

    return chunks.length;
  }
}
