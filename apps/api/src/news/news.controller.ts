import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Sse,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, interval, map, startWith } from 'rxjs';
import { newsItems, desc, eq, and, sql, gte } from '@finsentinel/db';
import { Inject } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { parseIntParam } from '../common/utils/parse-int-param';
import { OnDemandNewsService } from './on-demand-news.service';
import { AgentService } from '../agent/agent.service';
import { randomUUID } from 'crypto';

/**
 * News controller — list, filter, ticker-specific, summary, stats, and SSE stream.
 */
@Controller('news')
@UseGuards(JwtGuard)
export class NewsController {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
    private readonly onDemandNewsService: OnDemandNewsService,
    private readonly agentService: AgentService,
  ) {}

  /** GET /news — list news with optional source filter + pagination. */
  @Get()
  async getNews(
    @Query('limit') limitParam?: string,
    @Query('offset') offsetParam?: string,
    @Query('source') source?: string,
  ) {
    const limit = parseIntParam(limitParam, 20, 1, 100);
    const offset = parseIntParam(offsetParam, 0, 0, 10000);

    let query = this.db
      .select()
      .from(newsItems)
      .orderBy(desc(newsItems.publishedAt))
      .limit(limit)
      .offset(offset);

    if (source) {
      query = this.db
        .select()
        .from(newsItems)
        .where(eq(newsItems.source, source))
        .orderBy(desc(newsItems.publishedAt))
        .limit(limit)
        .offset(offset);
    }

    return query;
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
      total: Number(totalResult[0]?.count ?? 0),
      today: Number(todayResult[0]?.count ?? 0),
      bySource: bySourceResult.map((r: { source: string; count: number }) => ({
        source: r.source,
        count: Number(r.count),
      })),
    };
  }

  /**
   * GET /news/by-ticker/:ticker — news for a specific ticker.
   *
   * Triggers on-demand fetch if no items exist, then returns from DB.
   */
  @Get('by-ticker/:ticker')
  async getByTicker(
    @Param('ticker') ticker: string,
    @Query('limit') limitParam?: string,
  ) {
    const limit = parseIntParam(limitParam, 20, 1, 100);
    const upperTicker = ticker.toUpperCase();

    // Check if we have any news for this ticker (tickers is jsonb array)
    let rows = await this.db
      .select()
      .from(newsItems)
      .where(sql`${newsItems.tickers}::jsonb @> ${JSON.stringify([upperTicker])}::jsonb`)
      .orderBy(desc(newsItems.publishedAt))
      .limit(limit);

    // On-demand fetch if empty
    if (rows.length === 0) {
      await this.onDemandNewsService.fetchForTickers([upperTicker]);
      rows = await this.db
        .select()
        .from(newsItems)
        .where(sql`${newsItems.tickers}::jsonb @> ${JSON.stringify([upperTicker])}::jsonb`)
        .orderBy(desc(newsItems.publishedAt))
        .limit(limit);
    }

    return rows;
  }

  /**
   * GET /news/summary/:ticker — AI-generated summary of recent news for a ticker.
   *
   * Returns SSE stream from the agent.
   */
  @Get('summary/:ticker')
  @RateLimit({ limit: 5, windowSecs: 300 })
  @UseGuards(RateLimitGuard)
  @HttpCode(HttpStatus.OK)
  async getSummary(
    @Param('ticker') ticker: string,
    @CurrentUser() user: CurrentUserPayload,
    @Res() res: Response,
  ) {
    const sessionId = randomUUID();
    const message = `Summarize the latest news and sentiment for ${ticker.toUpperCase()}. Focus on key developments, market impact, and overall sentiment.`;

    const sseStream = await this.agentService.streamChat(
      message,
      user.userId,
      [{ role: 'user', content: message }],
      sessionId,
    );

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = sseStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      res.end();
    }
  }

  /** SSE stream — heartbeat for real-time news polling. */
  @Sse('stream')
  streamNews(): Observable<MessageEvent> {
    return interval(30_000).pipe(
      startWith(0),
      map(() => {
        return { data: JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }) } as MessageEvent;
      }),
    );
  }
}
