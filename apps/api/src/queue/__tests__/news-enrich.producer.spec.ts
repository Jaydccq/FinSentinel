import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NewsEnrichProducer } from '../news-enrich.producer';
import { NEWS_ENRICH_QUEUE_TOKEN } from '../queue.constants';
import { MetricsService } from '../../common/services/metrics.service';

describe('NewsEnrichProducer', () => {
  let producer: NewsEnrichProducer;
  let mockQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        NewsEnrichProducer,
        { provide: NEWS_ENRICH_QUEUE_TOKEN, useValue: mockQueue },
        { provide: MetricsService, useValue: { incrementCounter: vi.fn(), setGauge: vi.fn() } },
      ],
    }).compile();

    producer = module.get(NewsEnrichProducer);
  });

  it('uses a stable job id so repeated enrichment requests dedupe in BullMQ', async () => {
    await producer.send('news-123');

    expect(mockQueue.add).toHaveBeenCalledWith(
      'news-enrich',
      { newsItemId: 'news-123' },
      expect.objectContaining({
        jobId: 'news-enrich:news-123',
      }),
    );
  });
});
