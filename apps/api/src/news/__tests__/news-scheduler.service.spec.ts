import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NewsSchedulerService } from '../news-scheduler.service';
import { NewsFetcherService } from '../news-fetcher.service';
import { NewsArchivalService } from '../news-archival.service';

function createConfigService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    NODE_ENV: 'development',
    'news.polling.enabled': true,
    'news.polling.intervalMs': 60000,
    'news.polling.startupDelayMs': 1000,
    'archival.enabled': true,
    'archival.cron': '5 * * * * *',
    ...overrides,
  };

  return {
    get: vi.fn((key: string, defaultValue?: unknown) =>
      key in values ? values[key] : defaultValue,
    ),
  };
}

describe('NewsSchedulerService', () => {
  let service: NewsSchedulerService;
  let mockFetcherService: { pollAll: ReturnType<typeof vi.fn> };
  let mockArchivalService: { archiveOldItems: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T15:00:00.000Z'));

    mockFetcherService = {
      pollAll: vi.fn().mockResolvedValue(3),
    };
    mockArchivalService = {
      archiveOldItems: vi.fn().mockResolvedValue(2),
    };

    const module = await Test.createTestingModule({
      providers: [
        NewsSchedulerService,
        {
          provide: ConfigService,
          useValue: createConfigService(),
        },
        {
          provide: NewsFetcherService,
          useValue: mockFetcherService,
        },
        {
          provide: NewsArchivalService,
          useValue: mockArchivalService,
        },
      ],
    }).compile();

    service = module.get(NewsSchedulerService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('runs startup polling, recurring polling, and archival cron jobs', async () => {
    service.onModuleInit();

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockFetcherService.pollAll).toHaveBeenCalledTimes(1);
    expect(mockArchivalService.archiveOldItems).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    expect(mockArchivalService.archiveOldItems).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60000);
    expect(mockFetcherService.pollAll).toHaveBeenCalledTimes(2);
    expect(mockArchivalService.archiveOldItems).toHaveBeenCalledTimes(2);
  });

  it('does not schedule background work when disabled or in test env', async () => {
    const module = await Test.createTestingModule({
      providers: [
        NewsSchedulerService,
        {
          provide: ConfigService,
          useValue: createConfigService({
            NODE_ENV: 'test',
            'news.polling.enabled': true,
            'archival.enabled': true,
          }),
        },
        {
          provide: NewsFetcherService,
          useValue: mockFetcherService,
        },
        {
          provide: NewsArchivalService,
          useValue: mockArchivalService,
        },
      ],
    }).compile();

    const disabledService = module.get(NewsSchedulerService);
    disabledService.onModuleInit();

    await vi.advanceTimersByTimeAsync(120000);

    expect(mockFetcherService.pollAll).not.toHaveBeenCalled();
    expect(mockArchivalService.archiveOldItems).not.toHaveBeenCalled();

    disabledService.onModuleDestroy();
  });
});
