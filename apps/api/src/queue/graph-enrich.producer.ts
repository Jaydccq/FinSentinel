import { Injectable, Inject, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { GRAPH_ENRICH_QUEUE_TOKEN } from './queue.constants';

export interface GraphEnrichJobData {
  sourceType: 'document' | 'news';
  sourceId: string;
}

@Injectable()
export class GraphEnrichProducer {
  private readonly logger = new Logger(GraphEnrichProducer.name);

  constructor(
    @Inject(GRAPH_ENRICH_QUEUE_TOKEN) private readonly queue: Queue,
  ) {}

  async enqueue(data: GraphEnrichJobData): Promise<void> {
    await this.queue.add('graph-enrich', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    this.logger.debug(`Enqueued graph enrichment for ${data.sourceType}/${data.sourceId}`);
  }
}
