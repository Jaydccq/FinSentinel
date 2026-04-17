import { Injectable, Inject, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { AnalysisStageKey } from '@finsentinel/shared';
import { ANALYSIS_RUN_QUEUE_TOKEN } from './queue.constants';
import { MetricsService } from '../common/services/metrics.service';

export type AnalysisRunStepKind = 'PREFLIGHT' | 'EXECUTE_STAGE' | 'RESUME';

export interface AnalysisRunJobData {
  runId: string;
  userId: string;
  stepKind: AnalysisRunStepKind;
  stageKey?: AnalysisStageKey;
}

@Injectable()
export class AnalysisRunProducer {
  private readonly logger = new Logger(AnalysisRunProducer.name);

  constructor(
    @Inject(ANALYSIS_RUN_QUEUE_TOKEN) private readonly queue: Queue<AnalysisRunJobData>,
    private readonly metrics: MetricsService,
  ) {}

  async enqueuePreflight(args: { runId: string; userId: string }): Promise<void> {
    await this.queue.add(
      'preflight',
      { ...args, stepKind: 'PREFLIGHT' },
      {
        jobId: `analysis-${args.runId}-preflight`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    this.bumpMetrics('preflight');
  }

  async enqueueExecuteStage(args: {
    runId: string;
    userId: string;
    stageKey: AnalysisStageKey;
  }): Promise<void> {
    await this.queue.add(
      'execute-stage',
      { ...args, stepKind: 'EXECUTE_STAGE' },
      {
        jobId: `analysis-${args.runId}-stage-${args.stageKey}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    this.bumpMetrics('execute-stage');
  }

  async enqueueResume(args: { runId: string; userId: string }): Promise<void> {
    await this.queue.add(
      'resume',
      { ...args, stepKind: 'RESUME' },
      {
        jobId: `analysis-${args.runId}-resume`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    );
    this.bumpMetrics('resume');
  }

  private bumpMetrics(jobName: string): void {
    this.metrics.incrementCounter(
      'analysis_run_jobs_enqueued_total',
      'Total analysis-run jobs enqueued',
      { job_name: jobName },
    );
    this.metrics.setGauge(
      'analysis_run_job_enqueue_last_timestamp_seconds',
      'Timestamp of most recent analysis-run enqueue',
      { job_name: jobName },
      Date.now() / 1000,
    );
  }
}
