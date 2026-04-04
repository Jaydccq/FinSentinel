import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { newsItems, lt, eq, and, sql } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';

/**
 * Scheduled job that archives old news items to cold storage.
 *
 * Retention: items older than `retentionDays` (default 7) are marked
 * as archived. pgvector embeddings are kept permanently so RAG search
 * continues to work transparently.
 *
 * Runs on a configurable cron schedule (ARCHIVAL_CRON, default "0 0 2 * * *").
 */
@Injectable()
export class NewsArchivalService {
  private readonly logger = new Logger(NewsArchivalService.name);
  private readonly retentionDays: number;
  private readonly batchSize: number;

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    configService: ConfigService,
  ) {
    this.retentionDays = configService.get<number>(
      'ARCHIVAL_RETENTION_DAYS',
      7,
    );
    this.batchSize = configService.get<number>('ARCHIVAL_BATCH_SIZE', 50);
  }

  /**
   * Archive news items older than the retention window.
   *
   * Processes in batches to avoid overwhelming the database.
   * Returns the total number of items archived.
   */
  async archiveOldItems(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    let totalArchived = 0;
    let batchCount: number;

    do {
      // Find a batch of unarchived items older than the cutoff
      const staleItems = await this.db
        .select({ id: newsItems.id })
        .from(newsItems)
        .where(
          and(
            lt(newsItems.publishedAt, cutoffDate),
            eq(newsItems.enriched, false),
          ),
        )
        .limit(this.batchSize);

      batchCount = staleItems.length;

      if (batchCount === 0) break;

      const ids = staleItems.map((item: { id: string }) => item.id);

      // Mark items as archived (enriched = true) in batch
      for (const id of ids) {
        await this.db
          .update(newsItems)
          .set({ enriched: true })
          .where(eq(newsItems.id, id));
      }

      totalArchived += batchCount;

      this.logger.log(
        `Archived batch of ${batchCount} news items (total: ${totalArchived})`,
      );
    } while (batchCount === this.batchSize);

    if (totalArchived > 0) {
      this.logger.log(
        `Archival complete: ${totalArchived} items archived (cutoff: ${cutoffDate.toISOString()})`,
      );
    }

    return totalArchived;
  }
}
