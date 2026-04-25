import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { REPRESENTATION_ENRICH_QUEUE } from './queue.constants';
import {
  ChunkRepresentationService,
  ChunkNotFoundError,
} from '../rag/chunk-representation.service';
import type { RepresentationEnrichJobData } from './representation-enrich.producer';

@Injectable()
export class RepresentationEnrichConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RepresentationEnrichConsumer.name);
  private readonly concurrency: number;
  private readonly enabled: boolean;
  private worker?: Worker<RepresentationEnrichJobData>;

  constructor(
    @Inject('BULLMQ_CONNECTION') private readonly connection: ConnectionOptions,
    private readonly representationService: ChunkRepresentationService,
    configService: ConfigService,
  ) {
    this.concurrency = configService.get<number>('RAG_REPRESENTATION_CONCURRENCY', 4);
    this.enabled = configService.get<boolean>('RAG_ENRICHMENT_ENABLED', false);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('RepresentationEnrichConsumer disabled (RAG_ENRICHMENT_ENABLED=false)');
      return;
    }
    this.worker = new Worker<RepresentationEnrichJobData>(
      REPRESENTATION_ENRICH_QUEUE,
      async (job) => this.process(job),
      { connection: this.connection, concurrency: this.concurrency },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Representation enrich job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
      );
    });

    this.worker.on('completed', (job) => {
      this.logger.debug(`Representation enrich job ${job.id} completed`);
    });

    this.logger.log(
      `RepresentationEnrichConsumer worker started (concurrency=${this.concurrency})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('RepresentationEnrichConsumer worker stopped');
    }
  }

  async process(job: Job<RepresentationEnrichJobData>): Promise<void> {
    const { chunkId } = job.data;
    this.logger.log(`Processing representation enrichment for chunk ${chunkId}`);

    try {
      const result = await this.representationService.enrichChunk(chunkId);

      if (result.status === 'failed') {
        // Check if the failure was a circuit breaker trip so BullMQ re-queues
        if (result.reason?.includes('circuit breaker open')) {
          throw new Error(`circuit breaker open: retryable — ${result.reason}`);
        }
        this.logger.warn(`Representation enrichment failed for chunk ${chunkId}: ${result.reason}`);
      }
    } catch (err) {
      if (err instanceof ChunkNotFoundError) {
        this.logger.warn(`Chunk not found for job ${job.id}, chunkId=${chunkId}: ${err.message}`);
        throw err;
      }
      throw err;
    }
  }
}
