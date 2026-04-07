import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { GRAPH_ENRICH_QUEUE } from './queue.constants';
import type { GraphEnrichJobData } from './graph-enrich.producer';

/**
 * BullMQ worker that processes graph enrichment jobs.
 *
 * Pipeline (to be implemented when sidecar /extract-entities is ready):
 * 1. Load chunks for the source from document_chunks
 * 2. Call reranker sidecar /extract-entities with chunk texts
 * 3. Upsert entities + relations + chunk_entity_links
 * 4. Update document_chunks.meta_entities (triggers search_vector rebuild)
 */
@Injectable()
export class GraphEnrichConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphEnrichConsumer.name);
  private worker!: Worker<GraphEnrichJobData>;

  constructor(
    @Inject('BULLMQ_CONNECTION') private readonly connection: ConnectionOptions,
  ) {}

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
    // TODO: Implement when sidecar /extract-entities is ready
    // 1. Load chunks for sourceType/sourceId from document_chunks
    // 2. Batch call sidecar /extract-entities
    // 3. Upsert knowledge_entities, knowledge_relations, chunk_entity_links
    // 4. Update document_chunks.meta_entities + rebuild search_vector
  }
}
