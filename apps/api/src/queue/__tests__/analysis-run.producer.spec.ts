import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { AnalysisRunProducer } from '../analysis-run.producer';
import { ANALYSIS_RUN_QUEUE_TOKEN } from '../queue.constants';
import { MetricsService } from '../../common/services/metrics.service';

describe('AnalysisRunProducer', () => {
  let producer: AnalysisRunProducer;
  let mockQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockQueue = { add: vi.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        AnalysisRunProducer,
        { provide: ANALYSIS_RUN_QUEUE_TOKEN, useValue: mockQueue },
        {
          provide: MetricsService,
          useValue: {
            incrementCounter: vi.fn(),
            setGauge: vi.fn(),
            observeHistogram: vi.fn(),
            startHistogramTimer: vi.fn(() => vi.fn()),
          },
        },
      ],
    }).compile();
    producer = module.get(AnalysisRunProducer);
  });

  it('enqueues a preflight job with a stable dedupe id', async () => {
    await producer.enqueuePreflight({ runId: 'r1', userId: 'u1' });
    expect(mockQueue.add).toHaveBeenCalledWith(
      'preflight',
      { runId: 'r1', userId: 'u1', stepKind: 'PREFLIGHT' },
      expect.objectContaining({ jobId: 'analysis:r1:preflight' }),
    );
  });

  it('enqueues an execute-stage job keyed by runId+stageKey', async () => {
    await producer.enqueueExecuteStage({
      runId: 'r1',
      userId: 'u1',
      stageKey: 'INTELLIGENCE',
    });
    expect(mockQueue.add).toHaveBeenCalledWith(
      'execute-stage',
      {
        runId: 'r1',
        userId: 'u1',
        stepKind: 'EXECUTE_STAGE',
        stageKey: 'INTELLIGENCE',
      },
      expect.objectContaining({ jobId: 'analysis:r1:stage:INTELLIGENCE' }),
    );
  });

  it('enqueues a resume job without a stage (orchestrator decides)', async () => {
    await producer.enqueueResume({ runId: 'r1', userId: 'u1' });
    expect(mockQueue.add).toHaveBeenCalledWith(
      'resume',
      { runId: 'r1', userId: 'u1', stepKind: 'RESUME' },
      expect.objectContaining({ jobId: 'analysis:r1:resume' }),
    );
  });
});
