import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NewsFetcherService } from './news-fetcher.service';
import { NewsController } from './news.controller';

/**
 * News module -- Phase 7.
 *
 * Provides:
 * - NewsFetcherService — orchestrates all NewsFetcher implementations, deduplicates, persists
 * - NewsController — GET /news, GET /news/stream (SSE)
 *
 * Actual fetcher implementations (Polygon, RSS, 6551.io) are registered via
 * the NEWS_FETCHERS injection token. By default, no fetchers are registered.
 */
@Module({
  imports: [AuthModule],
  controllers: [NewsController],
  providers: [
    NewsFetcherService,
    {
      provide: 'NEWS_FETCHERS',
      useValue: [], // Fetchers are added incrementally as APIs become available
    },
  ],
  exports: [NewsFetcherService],
})
export class NewsModule {}
