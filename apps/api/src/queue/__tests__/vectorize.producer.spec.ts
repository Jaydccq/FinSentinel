import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { VectorizeProducer } from '../vectorize.producer';
import { VECTORIZE_QUEUE_TOKEN } from '../queue.constants';
import { MetricsService } from '../../common/services/metrics.service';

describe('VectorizeProducer', () => {
  let producer: VectorizeProducer;
  let mockQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        VectorizeProducer,
        { provide: VECTORIZE_QUEUE_TOKEN, useValue: mockQueue },
        { provide: MetricsService, useValue: { incrementCounter: vi.fn(), setGauge: vi.fn(), observeHistogram: vi.fn(), startHistogramTimer: vi.fn(() => vi.fn()) } },
      ],
    }).compile();

    producer = module.get(VectorizeProducer);
  });

  it('uses a stable job id so repeated reindex requests dedupe in BullMQ', async () => {
    await producer.send('doc-123');

    expect(mockQueue.add).toHaveBeenCalledWith(
      'vectorize',
      { docId: 'doc-123' },
      expect.objectContaining({
        jobId: 'vectorize:doc-123',
      }),
    );
  });
});
