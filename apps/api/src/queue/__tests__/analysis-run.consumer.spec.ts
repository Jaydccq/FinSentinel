import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalysisRunConsumer } from '../analysis-run.consumer';
import type { Job } from 'bullmq';
import type { AnalysisRunJobData } from '../analysis-run.producer';

describe('AnalysisRunConsumer.process', () => {
  let consumer: AnalysisRunConsumer;
  let orchestrator: { step: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    orchestrator = { step: vi.fn().mockResolvedValue(undefined) };
    consumer = new AnalysisRunConsumer(
      { host: 'localhost', port: 6379 } as never,
      orchestrator as never,
    );
  });

  it('delegates PREFLIGHT jobs to orchestrator.step', async () => {
    const job = {
      data: { runId: 'r1', userId: 'u1', stepKind: 'PREFLIGHT' } satisfies AnalysisRunJobData,
    } as Job<AnalysisRunJobData>;
    await consumer.process(job);
    expect(orchestrator.step).toHaveBeenCalledWith(job.data);
  });

  it('propagates orchestrator errors so BullMQ can retry', async () => {
    orchestrator.step.mockRejectedValue(new Error('boom'));
    const job = {
      data: { runId: 'r1', userId: 'u1', stepKind: 'EXECUTE_STAGE', stageKey: 'INTELLIGENCE' },
    } as Job<AnalysisRunJobData>;
    await expect(consumer.process(job)).rejects.toThrow('boom');
  });
});
