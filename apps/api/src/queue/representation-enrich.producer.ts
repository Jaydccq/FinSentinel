import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { REPRESENTATION_ENRICH_QUEUE_TOKEN } from './queue.constants';

export interface RepresentationEnrichJobData {
  chunkId: string;
}

@Injectable()
export class RepresentationEnrichProducer {
  private readonly logger = new Logger(RepresentationEnrichProducer.name);
  private readonly enabled: boolean;
  private readonly maxChunksPerDoc: number;

  constructor(
    @Inject(REPRESENTATION_ENRICH_QUEUE_TOKEN) private readonly queue: Queue,
    configService: ConfigService,
  ) {
    this.enabled = configService.get<boolean>('RAG_ENRICHMENT_ENABLED', false);
    this.maxChunksPerDoc = configService.get<number>('RAG_REPRESENTATION_MAX_CHUNKS_PER_DOC', 2000);
  }

  async enqueueChunk(chunkId: string): Promise<void> {
    if (!this.enabled) return;

    await this.queue.add('representation-enrich', { chunkId } satisfies RepresentationEnrichJobData, {
      jobId: `rep-enrich:${chunkId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    this.logger.debug(`Enqueued representation enrichment for chunk ${chunkId}`);
  }

  async enqueueMany(chunkIds: string[]): Promise<void> {
    if (!this.enabled) return;
    if (chunkIds.length === 0) return;

    let ids = chunkIds;
    if (ids.length > this.maxChunksPerDoc) {
      const overflow = ids.length - this.maxChunksPerDoc;
      this.logger.warn(
        `enqueueMany: doc has ${ids.length} chunks which exceeds cap of ` +
        `${this.maxChunksPerDoc}; enqueueing first ${this.maxChunksPerDoc} only`,
        { chunk_id_overflow: overflow },
      );
      ids = ids.slice(0, this.maxChunksPerDoc);
    }

    await Promise.all(ids.map((id) => this.enqueueChunk(id)));
    this.logger.log(`Enqueued ${ids.length} representation enrichment jobs`);
  }
}
