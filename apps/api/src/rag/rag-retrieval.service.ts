import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RagSearchResult {
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

/**
 * RAG retrieval service — pgvector cosine similarity search.
 *
 * Executes vector similarity queries against the documents/embeddings
 * stored in pgvector. Supports filtering by docType, sector, regionId,
 * and afterDate.
 *
 * Note: Actual vector search requires embeddings to be loaded.
 * Until the embedding pipeline is wired, search returns empty results.
 */
@Injectable()
export class RagRetrievalService {
  private readonly logger = new Logger(RagRetrievalService.name);
  private readonly similarityThreshold: number;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
    configService: ConfigService,
  ) {
    this.similarityThreshold = configService.get<number>('RAG_SIMILARITY_THRESHOLD', 0.65);
  }

  /**
   * Search for similar documents using pgvector cosine similarity.
   *
   * @param query - The search query text (will be embedded for vector search)
   * @param topK - Maximum number of results to return (default: 5)
   * @param docType - Optional filter by document type (e.g. 'SEC_FILING', 'NEWS')
   * @param sector - Optional filter by sector (e.g. 'Technology')
   * @param regionId - Optional filter by region (e.g. 'US', 'CN')
   * @param afterDate - Optional ISO date string to filter documents after this date
   */
  async search(
    query: string,
    topK: number = 5,
    docType?: string,
    sector?: string,
    regionId?: string,
    afterDate?: string,
  ): Promise<RagSearchResult[]> {
    // Clamp topK to [1, 50]
    const safeTopK = Math.min(Math.max(topK, 1), 50);

    // TODO: Implement pgvector cosine similarity search
    // This requires:
    // 1. Embedding the query via the embedding model
    // 2. Running a raw SQL query with pgvector's <=> operator
    // 3. Applying metadata filters (docType, sector, regionId, afterDate)
    // 4. Filtering by similarity threshold (this.similarityThreshold)
    //
    // Example SQL:
    //   SELECT content, metadata, 1 - (embedding <=> $1) AS similarity
    //   FROM document_chunks
    //   WHERE 1 - (embedding <=> $1) >= $threshold
    //     AND ($docType IS NULL OR metadata->>'doc_type' = $docType)
    //     AND ($sector IS NULL OR metadata->>'sector' = $sector)
    //     AND ($regionId IS NULL OR metadata->>'region_id' = $regionId)
    //     AND ($afterDate IS NULL OR metadata->>'date' >= $afterDate)
    //   ORDER BY similarity DESC
    //   LIMIT $topK

    this.logger.debug(
      `RAG search: query="${query.substring(0, 50)}..." topK=${safeTopK} ` +
      `docType=${docType ?? 'any'} sector=${sector ?? 'any'} ` +
      `region=${regionId ?? 'any'} after=${afterDate ?? 'any'}`,
    );

    // No embeddings loaded yet — return empty
    return [];
  }

  /** Returns the configured similarity threshold. */
  getThreshold(): number {
    return this.similarityThreshold;
  }
}
