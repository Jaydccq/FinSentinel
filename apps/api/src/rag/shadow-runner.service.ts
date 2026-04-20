import { Injectable, Logger } from '@nestjs/common';

export interface ShadowRunnerConfig {
  concurrency: number;
  maxQueueDepth: number;
  timeoutMs: number;
}

export type ShadowOutcome = 'executed' | 'timed_out' | 'dropped_backpressure' | 'errored';

@Injectable()
export class ShadowRunnerService {
  private readonly logger = new Logger(ShadowRunnerService.name);
  private inflight = 0;
  private queued = 0;

  constructor(private readonly config: ShadowRunnerConfig) {}

  /**
   * Enqueue a shadow task. Never throws; returns an outcome flag.
   * - 'dropped_backpressure': queue depth + inflight would exceed cap; task not run.
   * - 'timed_out': task exceeded config.timeoutMs.
   * - 'errored': task threw a non-timeout error.
   * - 'executed': task completed successfully.
   */
  async enqueue<T>(task: () => Promise<T>): Promise<ShadowOutcome> {
    if (this.queued + this.inflight >= this.config.concurrency + this.config.maxQueueDepth) {
      return 'dropped_backpressure';
    }
    this.queued++;
    try {
      await this.waitForSlot();
    } finally {
      this.queued--;
    }
    this.inflight++;
    try {
      const timer = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('__shadow_timeout__')), this.config.timeoutMs),
      );
      await Promise.race([task(), timer]);
      return 'executed';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return msg === '__shadow_timeout__' ? 'timed_out' : 'errored';
    } finally {
      this.inflight--;
    }
  }

  private async waitForSlot(): Promise<void> {
    while (this.inflight >= this.config.concurrency) {
      await new Promise(r => setTimeout(r, 5));
    }
  }
}
