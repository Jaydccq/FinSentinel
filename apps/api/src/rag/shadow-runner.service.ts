import { Injectable, Logger } from '@nestjs/common';

export interface ShadowRunnerConfig {
  concurrency: number;
  maxQueueDepth: number;
  timeoutMs: number;
}

export type ShadowOutcome = 'executed' | 'timed_out' | 'dropped_backpressure' | 'errored';

/**
 * Tiny FIFO semaphore. acquire() resolves when a slot is free; release()
 * hands the slot to the next waiter. No polling — wakes the queued task as
 * soon as a slot opens up. Replaces the previous 5ms setTimeout poll loop.
 */
class Semaphore {
  private slots: number;
  private readonly waiters: Array<() => void> = [];

  constructor(initial: number) {
    this.slots = initial;
  }

  async acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.slots++;
    }
  }

  /** For backpressure bookkeeping. */
  get pending(): number {
    return this.waiters.length;
  }
}

@Injectable()
export class ShadowRunnerService {
  private readonly logger = new Logger(ShadowRunnerService.name);
  private readonly slots: Semaphore;
  private active = 0;

  constructor(private readonly config: ShadowRunnerConfig) {
    this.slots = new Semaphore(config.concurrency);
  }

  /**
   * Enqueue a shadow task. Never throws; returns an outcome flag.
   * - 'dropped_backpressure': queue depth + active would exceed cap; task not run.
   * - 'timed_out': task exceeded config.timeoutMs.
   * - 'errored': task threw a non-timeout error.
   * - 'executed': task completed successfully.
   */
  async enqueue<T>(task: () => Promise<T>): Promise<ShadowOutcome> {
    const cap = this.config.concurrency + this.config.maxQueueDepth;
    if (this.slots.pending + this.active >= cap) {
      return 'dropped_backpressure';
    }

    await this.slots.acquire();
    this.active++;
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
      this.active--;
      this.slots.release();
    }
  }
}
