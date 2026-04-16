import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Sse,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { newsItems, desc, asc, eq, and, sql, gte, gt } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { Inject } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { parseIntParam } from '../common/utils/parse-int-param';
import { OnDemandNewsService } from './on-demand-news.service';
import { NewsFetcherService } from './news-fetcher.service';
import { RagReindexService } from '../rag/rag-reindex.service';

const NEWS_FEED_STALE_MS = 60 * 60 * 1000;

/**
 * News controller — list, filter, ticker-specific, summary, stats, and SSE stream.
 */
@Controller('news')
@UseGuards(JwtGuard)
export class NewsController {
  private readonly logger = new Logger(NewsController.name);

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    private readonly onDemandNewsService: OnDemandNewsService,
    private readonly ragReindexService: RagReindexService,
    private readonly newsFetcherService: NewsFetcherService,
  ) {}

  /** GET /news — list news with optional source filter + pagination. */
  @Get()
  async getNews(
    @Query('page') pageParam?: string,
    @Query('size') sizeParam?: string,
    @Query('source') source?: string,
  ) {
    const page = parseIntParam(pageParam, 0, 0, 1000);
    const size = parseIntParam(sizeParam, 50, 1, 100);
    const offset = page * size;

    const conditions: Array<ReturnType<typeof eq>> = [];
    if (source) conditions.push(eq(newsItems.source, source));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    let rows = await this.queryNewsRows(whereClause, size, offset);

    if (page === 0 && this.needsRefresh(rows[0]?.publishedAt)) {
      try {
        await this.newsFetcherService.pollAll();
        rows = await this.queryNewsRows(whereClause, size, offset);
      } catch (error) {
        this.logger.warn(
          `Global news refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const countResult = whereClause
      ? await this.db.select({ count: sql<number>`count(*)` }).from(newsItems).where(whereClause)
      : await this.db.select({ count: sql<number>`count(*)` }).from(newsItems);

    const totalElements = Number(countResult[0]?.count ?? 0);
    return { content: rows, totalPages: Math.ceil(totalElements / size), totalElements, number: page };
  }

  /**
   * GET /news/stats — feed statistics.
   *
   * Returns today's count, total count, and count by source.
   */
  @Get('stats')
  async getStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalResult, todayResult, bySourceResult] = await Promise.all([
      this.db.select({ count: sql<number>`count(*)` }).from(newsItems),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(newsItems)
        .where(gte(newsItems.publishedAt, todayStart)),
      this.db
        .select({
          source: newsItems.source,
          count: sql<number>`count(*)`,
        })
        .from(newsItems)
        .groupBy(newsItems.source),
    ]);

    return {
      totalCount: Number(totalResult[0]?.count ?? 0),
      todayCount: Number(todayResult[0]?.count ?? 0),
      countBySource: Object.fromEntries(
        bySourceResult.map((r: { source: string; count: number }) => [r.source, Number(r.count)])
      ),
    };
  }

  /** Requeue news items that predate the chunk index and are missing stored vectors. */
  @Post('reindex-missing')
  @RateLimit({ limit: 2, windowSecs: 300 })
  @UseGuards(RateLimitGuard)
  async reindexMissing(
    @Query('limit') limitParam?: string,
    @Query('force') forceParam?: string,
  ) {
    const limit = parseIntParam(limitParam, 100, 1, 500);
    const force = forceParam === 'true';
    return this.ragReindexService.reindexMissingNews(limit, force);
  }

  /**
   * GET /news/by-ticker/:ticker — news for a specific ticker.
   *
   * Triggers on-demand fetch if no items exist, then returns from DB.
   */
  @Get('by-ticker/:ticker')
  async getByTicker(
    @Param('ticker') ticker: string,
    @Query('page') pageParam?: string,
    @Query('size') sizeParam?: string,
  ) {
    const page = parseIntParam(pageParam, 0, 0, 1000);
    const size = parseIntParam(sizeParam, 20, 1, 100);
    const offset = page * size;
    const upperTicker = ticker.toUpperCase();

    const tickerWhere = sql`${newsItems.tickers}::jsonb @> ${JSON.stringify([upperTicker])}::jsonb`;

    // Check if we have any news for this ticker (tickers is jsonb array)
    let rows = await this.db
      .select()
      .from(newsItems)
      .where(tickerWhere)
      .orderBy(desc(newsItems.publishedAt))
      .limit(size)
      .offset(offset);

    // On-demand fetch if empty or stale (first page only)
    if (page === 0 && this.needsRefresh(rows[0]?.publishedAt)) {
      try {
        await this.onDemandNewsService.fetchForTickers([upperTicker]);
        rows = await this.db
          .select()
          .from(newsItems)
          .where(tickerWhere)
          .orderBy(desc(newsItems.publishedAt))
          .limit(size)
          .offset(offset);
      } catch (error) {
        this.logger.warn(
          `Ticker news refresh failed for ${upperTicker}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(newsItems)
      .where(tickerWhere);

    const totalElements = Number(countResult[0]?.count ?? 0);
    return { content: rows, totalPages: Math.ceil(totalElements / size), totalElements, number: page };
  }

  /**
   * GET /news/summary/:ticker — summary of recent news for a ticker.
   *
   * Returns plain JSON with article count and generated summary text.
   */
  @Get('summary/:ticker')
  @RateLimit({ limit: 5, windowSecs: 300 })
  @UseGuards(RateLimitGuard)
  async getSummary(
    @Param('ticker') ticker: string,
  ) {
    const upperTicker = ticker.toUpperCase();
    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(newsItems)
      .where(sql`${newsItems.tickers}::jsonb @> ${JSON.stringify([upperTicker])}::jsonb`);

    const articleCount = Number(countResult[0]?.count ?? 0);
    return {
      ticker: upperTicker,
      summary: articleCount > 0
        ? `Found ${articleCount} recent articles for ${upperTicker}.`
        : `No recent news found for ${upperTicker}.`,
      articleCount,
      generatedAt: new Date().toISOString(),
    };
  }

  /** SSE stream — heartbeat for real-time news polling. */
  @Sse('stream')
  streamNews(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let lastSeenCreatedAt = new Date();
      let isPolling = false;

      const emitUpdates = async () => {
        if (isPolling) {
          return;
        }
        isPolling = true;

        try {
          const rows = await this.db
            .select()
            .from(newsItems)
            .where(gt(newsItems.createdAt, lastSeenCreatedAt))
            .orderBy(asc(newsItems.createdAt))
            .limit(50);

          for (const row of rows) {
            subscriber.next({ type: 'news', data: row } as MessageEvent);
          }

          const latest = rows.at(-1);
          if (latest?.createdAt) {
            lastSeenCreatedAt = latest.createdAt;
          }

          subscriber.next({
            type: 'heartbeat',
            data: { timestamp: new Date().toISOString(), delivered: rows.length },
          } as MessageEvent);
        } catch (error) {
          subscriber.error(error);
        } finally {
          isPolling = false;
        }
      };

      void emitUpdates();
      const timer = setInterval(() => {
        void emitUpdates();
      }, 30_000);

      return () => clearInterval(timer);
    });
  }

  private needsRefresh(publishedAt: Date | string | null | undefined): boolean {
    if (!publishedAt) {
      return true;
    }

    const publishedAtMs = new Date(publishedAt).getTime();
    if (Number.isNaN(publishedAtMs)) {
      return true;
    }

    return Date.now() - publishedAtMs >= NEWS_FEED_STALE_MS;
  }

  private queryNewsRows(whereClause: ReturnType<typeof and> | undefined, size: number, offset: number) {
    return whereClause
      ? this.db.select().from(newsItems).where(whereClause)
          .orderBy(desc(newsItems.publishedAt)).limit(size).offset(offset)
      : this.db.select().from(newsItems)
          .orderBy(desc(newsItems.publishedAt)).limit(size).offset(offset);
  }
}
