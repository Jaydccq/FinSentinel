import {
  Controller,
  Get,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable, interval, map, startWith } from 'rxjs';
import { newsItems, desc, eq, and } from '@finsentinel/db';
import { Inject } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { parseIntParam } from '../common/utils/parse-int-param';

/**
 * News controller — GET /news (paginated) and GET /news/stream (SSE).
 */
@Controller('news')
@UseGuards(JwtGuard)
export class NewsController {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
  ) {}

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

  @Sse('stream')
  streamNews(): Observable<MessageEvent> {
    // Poll DB every 30 seconds for new items
    return interval(30_000).pipe(
      startWith(0),
      map(() => {
        return { data: JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }) } as MessageEvent;
      }),
    );
  }
}
