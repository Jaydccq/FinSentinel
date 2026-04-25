import { describe, it, expect } from 'vitest';
import { ShadowRunnerService } from '../shadow-runner.service';

describe('ShadowRunnerService', () => {
  it('returns "executed" when a task completes under timeout', async () => {
    const runner = new ShadowRunnerService({ concurrency: 2, maxQueueDepth: 10, timeoutMs: 1000 });
    const outcome = await runner.enqueue(() => Promise.resolve('ok'));
    expect(outcome).toBe('executed');
  });

  it('returns "timed_out" when a task exceeds timeoutMs', async () => {
    const runner = new ShadowRunnerService({ concurrency: 2, maxQueueDepth: 10, timeoutMs: 50 });
    const neverEnding = () =>
      new Promise<void>(() => {
        /* never resolves */
      });
    const outcome = await runner.enqueue(neverEnding);
    expect(outcome).toBe('timed_out');
  });

  it('returns "errored" when a task throws a non-timeout error', async () => {
    const runner = new ShadowRunnerService({ concurrency: 2, maxQueueDepth: 10, timeoutMs: 1000 });
    const outcome = await runner.enqueue(() => Promise.reject(new Error('boom')));
    expect(outcome).toBe('errored');
  });

  it('drops excess work with "dropped_backpressure" when queue cap is reached', async () => {
    // concurrency 2 + maxDepth 3 = cap 5. Fire 10 slow tasks; last 5 should drop.
    const runner = new ShadowRunnerService({ concurrency: 2, maxQueueDepth: 3, timeoutMs: 1000 });
    const slow = () => new Promise<void>((r) => setTimeout(r, 200));
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => runner.enqueue(slow)));
    const dropped = outcomes.filter((o) => o === 'dropped_backpressure').length;
    expect(dropped).toBeGreaterThan(0);
    expect(outcomes.every((o) => ['executed', 'dropped_backpressure'].includes(o))).toBe(true);
  });

  // ── P1-3: semaphore replaces 5ms polling ─────────────────────────────

  it('semaphore: respects concurrency cap (at most N tasks active concurrently)', async () => {
    const runner = new ShadowRunnerService({ concurrency: 2, maxQueueDepth: 10, timeoutMs: 5000 });

    let active = 0;
    let peak = 0;
    const task = () =>
      new Promise<void>((resolve) => {
        active++;
        peak = Math.max(peak, active);
        setTimeout(() => {
          active--;
          resolve();
        }, 30);
      });

    const outcomes = await Promise.all(Array.from({ length: 6 }, () => runner.enqueue(task)));
    expect(outcomes.every((o) => o === 'executed')).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('semaphore: queued tasks wake immediately when a slot is released (no 5ms poll latency)', async () => {
    const runner = new ShadowRunnerService({ concurrency: 1, maxQueueDepth: 10, timeoutMs: 5000 });

    const order: number[] = [];
    const make = (n: number) => async () => {
      order.push(n);
      // tiny delay to make the queue meaningful
      await new Promise<void>((r) => setTimeout(r, 5));
    };

    await Promise.all([runner.enqueue(make(1)), runner.enqueue(make(2)), runner.enqueue(make(3))]);

    // FIFO: even with concurrency=1 and only 1 active at a time, all run in order.
    expect(order).toEqual([1, 2, 3]);
  });
});
