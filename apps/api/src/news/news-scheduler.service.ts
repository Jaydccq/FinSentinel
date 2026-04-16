import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import parser from 'cron-parser';
import { NewsArchivalService } from './news-archival.service';
import { NewsFetcherService } from './news-fetcher.service';

type PollTrigger = 'startup' | 'interval';
type ArchivalTrigger = 'cron';

@Injectable()
export class NewsSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NewsSchedulerService.name);
  private readonly pollingEnabled: boolean;
  private readonly pollingIntervalMs: number;
  private readonly pollingStartupDelayMs: number;
  private readonly archivalEnabled: boolean;
  private readonly archivalCron: string;

  private pollingIntervalHandle?: ReturnType<typeof setInterval>;
  private pollingStartupHandle?: ReturnType<typeof setTimeout>;
  private archivalTimeoutHandle?: ReturnType<typeof setTimeout>;
  private pollingRunning = false;
  private archivalRunning = false;

  constructor(
    private readonly newsFetcherService: NewsFetcherService,
    private readonly newsArchivalService: NewsArchivalService,
    configService: ConfigService,
  ) {
    const nodeEnv = configService.get<string>('NODE_ENV', 'development');
    const runtimeEnabled = nodeEnv !== 'test';

    this.pollingEnabled =
      runtimeEnabled && configService.get<boolean>('news.polling.enabled', true);
    this.pollingIntervalMs = configService.get<number>(
      'news.polling.intervalMs',
      300000,
    );
    this.pollingStartupDelayMs = configService.get<number>(
      'news.polling.startupDelayMs',
      10000,
    );

    this.archivalEnabled =
      runtimeEnabled && configService.get<boolean>('archival.enabled', false);
    this.archivalCron = configService.get<string>(
      'archival.cron',
      '0 0 2 * * *',
    );
  }

  onModuleInit(): void {
    this.startPollingLoop();
    this.scheduleNextArchivalRun();
  }

  onModuleDestroy(): void {
    if (this.pollingStartupHandle) {
      clearTimeout(this.pollingStartupHandle);
      this.pollingStartupHandle = undefined;
    }

    if (this.pollingIntervalHandle) {
      clearInterval(this.pollingIntervalHandle);
      this.pollingIntervalHandle = undefined;
    }

    if (this.archivalTimeoutHandle) {
      clearTimeout(this.archivalTimeoutHandle);
      this.archivalTimeoutHandle = undefined;
    }
  }

  async runPollingCycle(
    trigger: PollTrigger = 'interval',
  ): Promise<number> {
    if (!this.pollingEnabled) {
      return 0;
    }

    if (this.pollingRunning) {
      this.logger.warn(
        `Skipping overlapping news polling cycle triggered by ${trigger}`,
      );
      return 0;
    }

    this.pollingRunning = true;

    try {
      const savedCount = await this.newsFetcherService.pollAll();
      if (savedCount > 0) {
        this.logger.log(
          `News polling (${trigger}) saved ${savedCount} new item(s)`,
        );
      } else {
        this.logger.debug(`News polling (${trigger}) found no new items`);
      }
      return savedCount;
    } catch (error) {
      this.logger.error(
        `News polling (${trigger}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    } finally {
      this.pollingRunning = false;
    }
  }

  async runArchivalCycle(
    trigger: ArchivalTrigger = 'cron',
  ): Promise<number> {
    if (!this.archivalEnabled) {
      return 0;
    }

    if (this.archivalRunning) {
      this.logger.warn(
        `Skipping overlapping archival cycle triggered by ${trigger}`,
      );
      return 0;
    }

    this.archivalRunning = true;

    try {
      const archivedCount = await this.newsArchivalService.archiveOldItems();
      if (archivedCount > 0) {
        this.logger.log(
          `News archival (${trigger}) archived ${archivedCount} item(s)`,
        );
      } else {
        this.logger.debug(`News archival (${trigger}) found no stale items`);
      }
      return archivedCount;
    } catch (error) {
      this.logger.error(
        `News archival (${trigger}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    } finally {
      this.archivalRunning = false;
    }
  }

  private startPollingLoop(): void {
    if (!this.pollingEnabled) {
      this.logger.log('Automatic news polling disabled');
      return;
    }

    this.logger.log(
      `Automatic news polling enabled: startupDelay=${this.pollingStartupDelayMs}ms interval=${this.pollingIntervalMs}ms`,
    );

    const startRecurring = () => {
      if (this.pollingIntervalHandle) {
        return;
      }

      this.pollingIntervalHandle = setInterval(() => {
        void this.runPollingCycle('interval');
      }, this.pollingIntervalMs);
    };

    if (this.pollingStartupDelayMs <= 0) {
      void this.runPollingCycle('startup');
      startRecurring();
      return;
    }

    this.pollingStartupHandle = setTimeout(() => {
      this.pollingStartupHandle = undefined;
      void this.runPollingCycle('startup');
      startRecurring();
    }, this.pollingStartupDelayMs);
  }

  private scheduleNextArchivalRun(fromDate: Date = new Date()): void {
    if (!this.archivalEnabled) {
      this.logger.log('Automatic news archival disabled');
      return;
    }

    let nextRun: Date;
    try {
      const schedule = parser.parseExpression(this.archivalCron, {
        currentDate: fromDate,
      });
      nextRun = schedule.next().toDate();
    } catch (error) {
      this.logger.error(
        `Invalid archival cron "${this.archivalCron}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const delayMs = Math.max(nextRun.getTime() - fromDate.getTime(), 0);
    this.logger.log(
      `Automatic news archival scheduled for ${nextRun.toISOString()} (${delayMs}ms)`,
    );

    this.archivalTimeoutHandle = setTimeout(() => {
      this.archivalTimeoutHandle = undefined;
      void this.runArchivalCycle('cron').finally(() => {
        this.scheduleNextArchivalRun(new Date());
      });
    }, delayMs);
  }
}
