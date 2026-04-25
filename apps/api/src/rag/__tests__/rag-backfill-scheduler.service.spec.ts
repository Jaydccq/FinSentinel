import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RagBackfillSchedulerService } from '../rag-backfill-scheduler.service';
import { RagReindexService } from '../rag-reindex.service';
import { MetricsService } from '../../common/services/metrics.service';

const emptyResult = { queued: 0, ids: [] };

function createConfigService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    NODE_ENV: 'development',
    'rag.backfill.enabled': true,
    'rag.backfill.intervalMs': 60000,
    'rag.backfill.startupDelayMs': 5000,
    'rag.backfill.documentBatchSize': 11,
    'rag.backfill.newsBatchSize': 7,
    'rag.backfill.force': false,
    ...overrides,
  };

  return {
    get: vi.fn((key: string, defaultValue?: unknown) =>
      key in values ? values[key] : defaultValue,
    ),
  };
}

describe('RagBackfillSchedulerService', () => {
  let service: RagBackfillSchedulerService;
  let mockReindexService: {
    reindexMissingDocuments: ReturnType<typeof vi.fn>;
    reindexMissingNews: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.useFakeTimers();

    mockReindexService = {
      reindexMissingDocuments: vi.fn().mockResolvedValue(emptyResult),
      reindexMissingNews: vi.fn().mockResolvedValue(emptyResult),
    };

    const module = await Test.createTestingModule({
      providers: [
        RagBackfillSchedulerService,
        {
          provide: ConfigService,
          useValue: createConfigService(),
        },
        {
          provide: RagReindexService,
          useValue: mockReindexService,
        },
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

    service = module.get(RagBackfillSchedulerService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('runs startup backfill and recurring interval with configured batch sizes', async () => {
    service.onModuleInit();

    await vi.advanceTimersByTimeAsync(5000);

    expect(mockReindexService.reindexMissingDocuments).toHaveBeenCalledWith(11, false);
    expect(mockReindexService.reindexMissingNews).toHaveBeenCalledWith(7, false);

    await vi.advanceTimersByTimeAsync(60000);

    expect(mockReindexService.reindexMissingDocuments).toHaveBeenCalledTimes(2);
    expect(mockReindexService.reindexMissingNews).toHaveBeenCalledTimes(2);
  });

  it('does not schedule background work when disabled', async () => {
    const module = await Test.createTestingModule({
      providers: [
        RagBackfillSchedulerService,
        {
          provide: ConfigService,
          useValue: createConfigService({ 'rag.backfill.enabled': false }),
        },
        {
          provide: RagReindexService,
          useValue: mockReindexService,
        },
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

    const disabledService = module.get(RagBackfillSchedulerService);
    disabledService.onModuleInit();

    await vi.advanceTimersByTimeAsync(120000);

    expect(mockReindexService.reindexMissingDocuments).not.toHaveBeenCalled();
    expect(mockReindexService.reindexMissingNews).not.toHaveBeenCalled();

    disabledService.onModuleDestroy();
  });

  it('skips overlapping backfill cycles', async () => {
    let resolveDocuments: (() => void) | undefined;
    mockReindexService.reindexMissingDocuments.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDocuments = () => resolve(emptyResult);
        }),
    );
    mockReindexService.reindexMissingNews.mockResolvedValue(emptyResult);

    const firstRun = service.runBackfillCycle('startup');
    const secondRun = await service.runBackfillCycle('interval');

    expect(secondRun.skipped).toBe(true);
    expect(mockReindexService.reindexMissingDocuments).toHaveBeenCalledTimes(1);

    resolveDocuments?.();
    const firstResult = await firstRun;
    expect(firstResult.skipped).toBe(false);
  });
});
