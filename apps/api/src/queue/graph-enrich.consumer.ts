import { randomUUID } from 'node:crypto';
import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { z } from 'zod';
import {
  sql,
  eq,
  and,
  documentChunks,
  knowledgeEntities,
  knowledgeRelations,
  chunkEntityLinks,
  RELATION_TYPES,
} from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { GRAPH_ENRICH_QUEUE } from './queue.constants';
import type { GraphEnrichJobData } from './graph-enrich.producer';

// ── Zod schemas for sidecar response ─────────────────────────────────────────

const extractedEntitySchema = z.object({
  name: z.string(),
  type: z.string(),
  confidence: z.number(),
  mention_text: z.string(),
});

const RELATION_TYPE_SET = new Set<string>(RELATION_TYPES);

const extractedRelationSchema = z.object({
  source: z.string(),
  target: z.string(),
  relation_type: z.string().refine(
    (v) => RELATION_TYPE_SET.has(v),
    (v) => ({ message: `Unknown relation_type: ${v}` }),
  ),
  confidence: z.number(),
  evidence: z.string().optional().nullable(),
  source_chunk_index: z.number().int().nonnegative(),
});

const sidecarResponseSchema = z.object({
  entities: z.array(extractedEntitySchema),
  relations: z.array(extractedRelationSchema).optional(),
});

type SidecarRelation = z.infer<typeof extractedRelationSchema>;

/**
 * BullMQ worker that processes graph enrichment jobs.
 *
 * Pipeline:
 * 1. Load chunks for the source from document_chunks
 * 2. Call reranker sidecar POST /extract-entities with chunk texts and extract_relations: true
 * 3. Upsert entities into knowledge_entities
 * 4. Link entities to chunks via chunk_entity_links
 * 5. Insert validated relations into knowledge_relations
 * 6. Update document_chunks.meta_entities + rebuild search_vector
 *
 * Relation contract (sidecar must include when extract_relations: true):
 * {
 *   "entities": [...],
 *   "relations": [
 *     {
 *       "source": "Apple Inc.",
 *       "target": "TSMC",
 *       "relation_type": "SUPPLIES_TO",   // must be one of RELATION_TYPES
 *       "confidence": 0.87,
 *       "evidence": "...",                // excerpt from chunk
 *       "source_chunk_index": 3           // index in texts[] sent
 *     }
 *   ]
 * }
 *
 * NOTE: The Python sidecar currently ignores extract_relations and does not return
 * relations. Extending the Python implementation is a follow-up tracked in CONCERNS.
 * This TypeScript path is complete and will wire through cleanly once the sidecar ships.
 */
@Injectable()
export class GraphEnrichConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphEnrichConsumer.name);
  private readonly sidecarUrl: string;
  private readonly minRelationConfidence: number;
  private worker!: Worker<GraphEnrichJobData>;

  constructor(
    @Inject('BULLMQ_CONNECTION') private readonly connection: ConnectionOptions,
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    configService: ConfigService,
  ) {
    this.sidecarUrl = configService.get<string>('RERANKER_URL', 'http://localhost:8100');
    this.minRelationConfidence = configService.get<number>(
      'rag.graph.minRelationConfidence',
      0.5,
    );
  }

  onModuleInit(): void {
    this.worker = new Worker<GraphEnrichJobData>(
      GRAPH_ENRICH_QUEUE,
      async (job) => this.process(job),
      { connection: this.connection, concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Graph enrich job ${job?.id} failed: ${err.message}`);
    });

    this.worker.on('completed', (job) => {
      this.logger.debug(`Graph enrich job ${job.id} completed`);
    });

    this.logger.log('GraphEnrichConsumer worker started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('GraphEnrichConsumer worker stopped');
    }
  }

  async process(job: Job<GraphEnrichJobData>): Promise<void> {
    const { sourceType, sourceId } = job.data;
    this.logger.log(`Processing graph enrichment for ${sourceType}/${sourceId}`);

    // 1. Load chunks for this source
    const chunks = await this.db
      .select({ id: documentChunks.id, content: documentChunks.content })
      .from(documentChunks)
      .where(and(
        eq(documentChunks.sourceType, sourceType),
        eq(documentChunks.sourceId, sourceId),
      ));

    if (chunks.length === 0) {
      this.logger.warn(`No chunks found for ${sourceType}/${sourceId}`);
      return;
    }

    // 2. Call sidecar /extract-entities with extract_relations: true
    const texts = chunks.map(c => c.content);
    let sidecarEntities: Array<{
      name: string;
      type: string;
      confidence: number;
      mention_text: string;
    }>;
    let sidecarRelations: SidecarRelation[] = [];

    try {
      const response = await fetch(`${this.sidecarUrl}/extract-entities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts, extract_relations: true }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Sidecar returned ${response.status}`);
      const raw = await response.json();
      const parsed = sidecarResponseSchema.safeParse(raw);
      if (!parsed.success) {
        this.logger.warn(
          `Sidecar response parse failed for ${sourceType}/${sourceId}: ${parsed.error.message}`,
        );
        return;
      }
      sidecarEntities = parsed.data.entities;
      sidecarRelations = parsed.data.relations ?? [];
    } catch (error) {
      this.logger.warn(`Entity extraction failed for ${sourceType}/${sourceId}: ${error}`);
      return;
    }

    if (sidecarEntities.length === 0) {
      this.logger.debug(`No entities extracted for ${sourceType}/${sourceId}`);
      return;
    }

    // 3. Upsert entities into knowledge_entities
    const entityIdMap = new Map<string, string>(); // name -> id
    for (const entity of sidecarEntities) {
      const existing = await this.db
        .select({ id: knowledgeEntities.id })
        .from(knowledgeEntities)
        .where(eq(knowledgeEntities.name, entity.name))
        .limit(1);

      if (existing.length > 0) {
        entityIdMap.set(entity.name, existing[0]!.id);
      } else {
        const newId = randomUUID();
        await this.db.insert(knowledgeEntities).values({
          id: newId,
          name: entity.name,
          type: entity.type,
          aliases: [],
          metadata: {},
        });
        entityIdMap.set(entity.name, newId);
      }
    }

    // 4. Link entities to chunks via chunk_entity_links
    for (const chunk of chunks) {
      const contentLower = chunk.content.toLowerCase();
      for (const entity of sidecarEntities) {
        if (contentLower.includes(entity.mention_text.toLowerCase())) {
          const entityId = entityIdMap.get(entity.name);
          if (!entityId) continue;

          await this.db.insert(chunkEntityLinks).values({
            id: randomUUID(),
            entityId,
            chunkId: chunk.id,
            mentionText: entity.mention_text,
            confidence: entity.confidence,
          }).onConflictDoNothing();
        }
      }
    }

    // 5. Insert validated relations into knowledge_relations
    let relationsInserted = 0;
    if (sidecarRelations.length > 0) {
      // Build a dedup set from existing relations for this source's chunks
      const chunkIds = chunks.map(c => c.id);
      const existingRelations = await this.db.execute(sql`
        SELECT source_entity_id, target_entity_id, relation_type, source_chunk_id
        FROM knowledge_relations
        WHERE source_chunk_id = ANY(ARRAY[${sql.join(chunkIds.map(id => sql`${id}::uuid`), sql`, `)}])
      `);
      // Dedup key: source_entity_id|target_entity_id|relation_type|source_chunk_id
      const existingSet = new Set<string>(
        (existingRelations as unknown as Array<{
          source_entity_id: string;
          target_entity_id: string;
          relation_type: string;
          source_chunk_id: string;
        }>).map(
          (r) => `${r.source_entity_id}|${r.target_entity_id}|${r.relation_type}|${r.source_chunk_id}`,
        ),
      );

      for (const rel of sidecarRelations) {
        // Validate relation_type (already enforced by zod, double-check for safety)
        if (!RELATION_TYPE_SET.has(rel.relation_type)) {
          this.logger.warn(
            `Dropping relation with unknown type "${rel.relation_type}" for ${sourceType}/${sourceId}`,
          );
          continue;
        }

        // Validate confidence threshold
        if (rel.confidence < this.minRelationConfidence) {
          this.logger.debug(
            `Dropping relation ${rel.source} -> ${rel.target} (confidence ${rel.confidence} < ${this.minRelationConfidence})`,
          );
          continue;
        }

        // Resolve entity IDs
        const sourceEntityId = entityIdMap.get(rel.source);
        const targetEntityId = entityIdMap.get(rel.target);
        if (!sourceEntityId) {
          this.logger.debug(
            `Dropping relation: source entity "${rel.source}" not in extracted entities`,
          );
          continue;
        }
        if (!targetEntityId) {
          this.logger.debug(
            `Dropping relation: target entity "${rel.target}" not in extracted entities`,
          );
          continue;
        }

        // Resolve chunk ID from source_chunk_index
        const sourceChunk = chunks[rel.source_chunk_index];
        if (!sourceChunk) {
          this.logger.warn(
            `Dropping relation: source_chunk_index ${rel.source_chunk_index} out of bounds for ${sourceType}/${sourceId}`,
          );
          continue;
        }
        const sourceChunkId = sourceChunk.id;

        // Dedup check
        const dedupKey = `${sourceEntityId}|${targetEntityId}|${rel.relation_type}|${sourceChunkId}`;
        if (existingSet.has(dedupKey)) {
          this.logger.debug(`Skipping duplicate relation: ${dedupKey}`);
          continue;
        }
        existingSet.add(dedupKey);

        // Every-column INSERT per CLAUDE.md
        const now = new Date();
        await this.db.insert(knowledgeRelations).values({
          id: randomUUID(),
          sourceEntityId,
          targetEntityId,
          relationType: rel.relation_type,
          confidence: rel.confidence,
          evidence: rel.evidence ?? null,
          sourceChunkId,
          createdAt: now,
        }).onConflictDoNothing();

        relationsInserted++;
      }
    }

    // 6. Update meta_entities and rebuild search_vector
    const entityNames = [...new Set(sidecarEntities.map(e => e.name))].join(' ');
    await this.db.execute(sql`
      UPDATE document_chunks
      SET
        meta_entities = ${entityNames},
        search_vector =
          setweight(to_tsvector('simple', coalesce(meta_title, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(meta_source, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(${entityNames}, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(content, '')), 'B')
      WHERE source_type = ${sourceType} AND source_id = ${sourceId}
    `);

    this.logger.log(
      `Graph enrichment complete for ${sourceType}/${sourceId}: ` +
      `${sidecarEntities.length} entities, ${chunks.length} chunks linked, ` +
      `${relationsInserted} relations inserted`,
    );
  }
}
