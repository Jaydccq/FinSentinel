import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { ANALYSIS_RUN_QUEUE } from './queue.constants';
import type { AnalysisRunJobData } from './analysis-run.producer';
import { RunOrchestratorService } from '../analysis/run-orchestrator.service';

@Injectable()
export class AnalysisRunConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisRunConsumer.name);
  private worker?: Worker<AnalysisRunJobData>;

  constructor(
    @Inject('BULLMQ_CONNECTION') private readonly connection: ConnectionOptions,
    private readonly orchestrator: RunOrchestratorService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AnalysisRunJobData>(
      ANALYSIS_RUN_QUEUE,
      async (job) => this.process(job),
      { connection: this.connection, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Analysis run job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
      );
    });
    this.worker.on('completed', (job) => {
      this.logger.debug(`Analysis run job ${job.id} completed`);
    });
    this.logger.log('AnalysisRunConsumer worker started');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.logger.log('AnalysisRunConsumer worker stopped');
  }

  async process(job: Job<AnalysisRunJobData>): Promise<void> {
    await this.orchestrator.step(job.data);
  }
}
