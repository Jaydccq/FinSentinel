import { randomUUID } from 'node:crypto';
import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import {
  sql,
  eq,
  and,
  documentChunks,
  knowledgeEntities,
  chunkEntityLinks,
} from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { GRAPH_ENRICH_QUEUE } from './queue.constants';
import type { GraphEnrichJobData } from './graph-enrich.producer';

/**
 * BullMQ worker that processes graph enrichment jobs.
 *
 * Pipeline:
 * 1. Load chunks for the source from document_chunks
 * 2. Call reranker sidecar POST /extract-entities with chunk texts
 * 3. Upsert entities into knowledge_entities
 * 4. Link entities to chunks via chunk_entity_links
 * 5. Update document_chunks.meta_entities + rebuild search_vector
 */
@Injectable()
export class GraphEnrichConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphEnrichConsumer.name);
  private readonly sidecarUrl: string;
  private worker!: Worker<GraphEnrichJobData>;

  constructor(
    @Inject('BULLMQ_CONNECTION') private readonly connection: ConnectionOptions,
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    configService: ConfigService,
  ) {
    this.sidecarUrl = configService.get<string>('RERANKER_URL', 'http://localhost:8100');
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

    // 2. Call sidecar /extract-entities
    const texts = chunks.map(c => c.content);
    let extractedEntities: Array<{
      name: string;
      type: string;
      confidence: number;
      mention_text: string;
    }>;
    try {
      const response = await fetch(`${this.sidecarUrl}/extract-entities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Sidecar returned ${response.status}`);
      const data = await response.json() as {
        entities: typeof extractedEntities;
      };
      extractedEntities = data.entities;
    } catch (error) {
      this.logger.warn(`Entity extraction failed for ${sourceType}/${sourceId}: ${error}`);
      return;
    }

    if (extractedEntities.length === 0) {
      this.logger.debug(`No entities extracted for ${sourceType}/${sourceId}`);
      return;
    }

    // 3. Upsert entities into knowledge_entities
    const entityIdMap = new Map<string, string>(); // name -> id
    for (const entity of extractedEntities) {
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
      for (const entity of extractedEntities) {
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

    // 5. Update meta_entities and rebuild search_vector
    //    Uses the same tsvector formula as RagChunkStoreService
    const entityNames = [...new Set(extractedEntities.map(e => e.name))].join(' ');
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
      `${extractedEntities.length} entities, ${chunks.length} chunks linked`,
    );
  }
}
