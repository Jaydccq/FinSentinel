import { Injectable, Inject, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { VECTORIZE_QUEUE_TOKEN } from './queue.constants';
import { MetricsService } from '../common/services/metrics.service';

/**
 * Enqueues document vectorization jobs.
 *
 * Usage: inject VectorizeProducer and call `send(docId)` after persisting
 * a Document record. The VectorizeConsumer will pick up the job and run
 * the parse -> chunk -> embed pipeline asynchronously.
 */
@Injectable()
export class VectorizeProducer {
  private readonly logger = new Logger(VectorizeProducer.name);

  constructor(
    @Inject(VECTORIZE_QUEUE_TOKEN) private readonly queue: Queue,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Add a vectorization job for the given document.
   *
   * @param docId - UUID of the document to vectorize
   */
  async send(docId: string): Promise<void> {
    await this.queue.add(
      'vectorize',
      { docId },
      {
        jobId: `vectorize:${docId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    this.metrics.incrementCounter(
      'rag_jobs_enqueued_total',
      'Total number of RAG-related jobs enqueued',
      { job_type: 'vectorize' },
    );
    this.metrics.setGauge(
      'rag_job_enqueue_last_timestamp_seconds',
      'Unix timestamp of the most recent RAG-related job enqueue',
      { job_type: 'vectorize' },
      Date.now() / 1000,
    );
    this.logger.log(`Enqueued vectorization job for document ${docId}`);
  }
}
