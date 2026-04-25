import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { RagEmbeddingService } from './rag-embedding.service';
import type { RankedCandidate } from './retrieval-fusion.service';

@Injectable()
export class GraphRetrievalService {
  private readonly logger = new Logger(GraphRetrievalService.name);

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly embeddingService: RagEmbeddingService,
  ) {}

  async search(
    entityNames: string[],
    query: string,
    topK: number,
    maxHops = 2,
    topologyWeight = 0.4,
    relevanceWeight = 0.6,
  ): Promise<RankedCandidate[]> {
    if (entityNames.length === 0) return [];

    // Step 1: Resolve entity names to IDs (fuzzy match)
    const entities = await this.db.execute(sql`
      SELECT id, name FROM knowledge_entities
      WHERE name ILIKE ANY(ARRAY[${sql.join(
        entityNames.map((n) => sql`${'%' + n + '%'}`),
        sql`, `,
      )}])
      LIMIT 20
    `);

    const entityIds = (entities as any[]).map((e) => e.id);
    if (entityIds.length === 0) {
      this.logger.debug(
        `Graph lane short-circuit: no knowledge_entities matched query names [${entityNames.join(', ')}]`,
      );
      return [];
    }

    // Step 2: Graph traversal via recursive CTE (1-2 hops)
    const graphChunks = await this.db.execute(sql`
      WITH RECURSIVE entity_graph AS (
        SELECT
          kr.target_entity_id AS entity_id,
          kr.confidence AS relation_confidence,
          1 AS hop_distance
        FROM knowledge_relations kr
        WHERE kr.source_entity_id = ANY(ARRAY[${sql.join(
          entityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}])

        UNION ALL

        SELECT
          kr.target_entity_id,
          eg.relation_confidence * kr.confidence,
          eg.hop_distance + 1
        FROM entity_graph eg
        JOIN knowledge_relations kr ON kr.source_entity_id = eg.entity_id
        WHERE eg.hop_distance < ${maxHops}
      ),
      related_chunks AS (
        SELECT DISTINCT ON (dc.id)
          dc.id AS chunk_id,
          dc.source_id,
          dc.content,
          dc.metadata,
          dc.embedding,
          eg.relation_confidence,
          eg.hop_distance
        FROM entity_graph eg
        JOIN chunk_entity_links cel ON cel.entity_id = eg.entity_id
        JOIN document_chunks dc ON dc.id = cel.chunk_id
        ORDER BY dc.id, eg.hop_distance ASC
      )
      SELECT * FROM related_chunks
      LIMIT ${topK * 3}
    `);

    if ((graphChunks as any[]).length === 0) return [];

    // Step 3: Score with topology * text relevance
    const queryEmbedding = await this.embeddingService.embedQuery(query);

    return (graphChunks as any[])
      .map((row) => {
        const hopDecay = row.hop_distance === 1 ? 1.0 : 0.6;
        const topologyScore = row.relation_confidence * hopDecay;
        const textRelevance = this.cosineSimilarity(queryEmbedding, row.embedding ?? []);
        const score = topologyWeight * topologyScore + relevanceWeight * textRelevance;

        return {
          chunkId: row.chunk_id,
          sourceId: row.source_id,
          content: row.content,
          metadata: row.metadata,
          score,
          lane: 'graph' as const,
        };
      })
      .filter((c) => c.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
    let dot = 0,
      normA = 0,
      normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
