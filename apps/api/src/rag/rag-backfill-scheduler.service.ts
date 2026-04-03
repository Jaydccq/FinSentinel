import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagReindexService, type ReindexResult } from './rag-reindex.service';
import { MetricsService } from '../common/services/metrics.service';

export interface RagBackfillRunResult {
  skipped: boolean;
  documents: ReindexResult;
  news: ReindexResult;
}

const EMPTY_REINDEX_RESULT: ReindexResult = { queued: 0, ids: [] };

@Injectable()
export class RagBackfillSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RagBackfillSchedulerService.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly startupDelayMs: number;
  private readonly documentBatchSize: number;
  private readonly newsBatchSize: number;
  private readonly force: boolean;

  private intervalHandle?: ReturnType<typeof setInterval>;
  private startupHandle?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(
    private readonly ragReindexService: RagReindexService,
    private readonly metrics: MetricsService,
    configService: ConfigService,
  ) {
    const nodeEnv = configService.get<string>('NODE_ENV', 'development');
    this.enabled =
      configService.get<boolean>('rag.backfill.enabled', true) &&
      nodeEnv !== 'test';
    this.intervalMs = configService.get<number>(
      'rag.backfill.intervalMs',
      900000,
    );
    this.startupDelayMs = configService.get<number>(
      'rag.backfill.startupDelayMs',
      30000,
    );
    this.documentBatchSize = configService.get<number>(
      'rag.backfill.documentBatchSize',
      25,
    );
    this.newsBatchSize = configService.get<number>(
      'rag.backfill.newsBatchSize',
      25,
    );
    this.force = configService.get<boolean>('rag.backfill.force', false);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Automatic RAG backfill disabled');
      return;
    }

    this.logger.log(
      `Automatic RAG backfill enabled: startupDelay=${this.startupDelayMs}ms interval=${this.intervalMs}ms docs=${this.documentBatchSize} news=${this.newsBatchSize} force=${this.force}`,
    );

    const startRecurring = () => {
      if (this.intervalHandle) {
        return;
      }
      this.intervalHandle = setInterval(() => {
        void this.runBackfillCycle('interval');
      }, this.intervalMs);
    };

    if (this.startupDelayMs <= 0) {
      void this.runBackfillCycle('startup');
      startRecurring();
      return;
    }

    this.startupHandle = setTimeout(() => {
      this.startupHandle = undefined;
      void this.runBackfillCycle('startup');
      startRecurring();
    }, this.startupDelayMs);
  }

  onModuleDestroy(): void {
    if (this.startupHandle) {
      clearTimeout(this.startupHandle);
      this.startupHandle = undefined;
    }
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async runBackfillCycle(
    trigger: 'startup' | 'interval' = 'interval',
  ): Promise<RagBackfillRunResult> {
    if (!this.enabled) {
      this.recordSkip(trigger, 'disabled');
      return {
        skipped: true,
        documents: EMPTY_REINDEX_RESULT,
        news: EMPTY_REINDEX_RESULT,
      };
    }

    if (this.running) {
      this.logger.warn(
        `Skipping overlapping RAG backfill cycle triggered by ${trigger}`,
      );
      this.recordSkip(trigger, 'overlap');
      return {
        skipped: true,
        documents: EMPTY_REINDEX_RESULT,
        news: EMPTY_REINDEX_RESULT,
      };
    }

    const startedAt = Date.now();
    this.running = true;
    this.metrics.setGauge(
      'rag_backfill_running',
      'Whether the automatic RAG backfill loop is currently running',
      {},
      1,
    );

    try {
      const [documents, news] = await Promise.all([
        this.ragReindexService.reindexMissingDocuments(
          this.documentBatchSize,
          this.force,
        ),
        this.ragReindexService.reindexMissingNews(
          this.newsBatchSize,
          this.force,
        ),
      ]);

      if (documents.queued > 0 || news.queued > 0) {
        this.logger.log(
          `RAG backfill (${trigger}) queued documents=${documents.queued} news=${news.queued}`,
        );
      } else {
        this.logger.debug(`RAG backfill (${trigger}) found no missing chunks`);
      }

      this.recordSuccess(trigger, startedAt, documents, news);

      return { skipped: false, documents, news };
    } catch (error) {
      this.logger.error(
        `RAG backfill (${trigger}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.metrics.incrementCounter(
        'rag_backfill_cycles_total',
        'Total automatic RAG backfill cycles by trigger and status',
        { trigger, status: 'error' },
      );
      this.metrics.setGauge(
        'rag_backfill_last_duration_ms',
        'Duration in milliseconds of the most recent automatic RAG backfill cycle',
        { trigger, status: 'error' },
        Date.now() - startedAt,
      );
      return {
        skipped: false,
        documents: EMPTY_REINDEX_RESULT,
        news: EMPTY_REINDEX_RESULT,
      };
    } finally {
      this.running = false;
      this.metrics.setGauge(
        'rag_backfill_running',
        'Whether the automatic RAG backfill loop is currently running',
        {},
        0,
      );
    }
  }

  private recordSkip(
    trigger: 'startup' | 'interval',
    reason: 'disabled' | 'overlap',
  ): void {
    this.metrics.incrementCounter(
      'rag_backfill_cycles_total',
      'Total automatic RAG backfill cycles by trigger and status',
      { trigger, status: `skipped_${reason}` },
    );
  }

  private recordSuccess(
    trigger: 'startup' | 'interval',
    startedAt: number,
    documents: ReindexResult,
    news: ReindexResult,
  ): void {
    this.metrics.incrementCounter(
      'rag_backfill_cycles_total',
      'Total automatic RAG backfill cycles by trigger and status',
      { trigger, status: 'success' },
    );
    this.metrics.incrementCounter(
      'rag_backfill_jobs_queued_total',
      'Total jobs queued by the automatic RAG backfill loop',
      { source_type: 'document' },
      documents.queued,
    );
    this.metrics.incrementCounter(
      'rag_backfill_jobs_queued_total',
      'Total jobs queued by the automatic RAG backfill loop',
      { source_type: 'news' },
      news.queued,
    );
    this.metrics.setGauge(
      'rag_backfill_last_queued_jobs',
      'Jobs queued by the most recent automatic RAG backfill cycle',
      { source_type: 'document' },
      documents.queued,
    );
    this.metrics.setGauge(
      'rag_backfill_last_queued_jobs',
      'Jobs queued by the most recent automatic RAG backfill cycle',
      { source_type: 'news' },
      news.queued,
    );
    this.metrics.setGauge(
      'rag_backfill_last_run_timestamp_seconds',
      'Unix timestamp of the most recent automatic RAG backfill cycle',
      { trigger },
      Date.now() / 1000,
    );
    this.metrics.setGauge(
      'rag_backfill_last_duration_ms',
      'Duration in milliseconds of the most recent automatic RAG backfill cycle',
      { trigger, status: 'success' },
      Date.now() - startedAt,
    );
  }
}
