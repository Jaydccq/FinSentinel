import { Module, forwardRef } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { TwitterModule } from '../twitter/twitter.module';
import { RagModule } from '../rag/rag.module';
import { NewsFetcherService } from './news-fetcher.service';
import { OnDemandNewsService } from './on-demand-news.service';
import { NewsSentimentService } from './news-sentiment.service';
import { NewsArchivalService } from './news-archival.service';
import { NewsSchedulerService } from './news-scheduler.service';
import { NewsController } from './news.controller';
import { PolygonNewsFetcher } from './fetchers/polygon-news.fetcher';
import { RssNewsFetcher } from './fetchers/rss-news.fetcher';
import { CryptoNewsApiClient } from './fetchers/crypto-news-api.client';
import { CryptoNewsFetcher } from './fetchers/crypto-news.fetcher';
import { XInfluencerFetcher } from './fetchers/x-influencer.fetcher';

/**
 * News module -- Phase 7.
 *
 * Provides:
 * - NewsFetcherService — orchestrates all NewsFetcher implementations, deduplicates, persists
 * - OnDemandNewsService — on-demand fetching for specific tickers
 * - NewsSentimentService — LLM-based sentiment classification
 * - NewsArchivalService — archival job implementation for old news items
 * - NewsSchedulerService — startup + recurring polling and archival scheduling
 * - NewsController — GET /news, GET /news/stream (SSE)
 *
 * Fetcher implementations:
 * - PolygonNewsFetcher — Polygon.io news API
 * - RssNewsFetcher — RSS feeds (CNBC, Reuters, etc.)
 * - CryptoNewsFetcher — 6551.io crypto news API (filtered by AI score)
 * - XInfluencerFetcher — Twitter/X influencer tweets via 6551.io
 */
@Module({
  imports: [CommonModule, AuthModule, TwitterModule, forwardRef(() => RagModule)],
  controllers: [NewsController],
  providers: [
    // ── Fetchers ────────────────────────────────────────────────────
    PolygonNewsFetcher,
    RssNewsFetcher,
    CryptoNewsApiClient,
    CryptoNewsFetcher,
    XInfluencerFetcher,

    // ── Injection token: all fetchers as array ──────────────────────
    {
      provide: 'NEWS_FETCHERS',
      useFactory: (
        polygon: PolygonNewsFetcher,
        rss: RssNewsFetcher,
        crypto: CryptoNewsFetcher,
        xInfluencer: XInfluencerFetcher,
      ) => [polygon, rss, crypto, xInfluencer],
      inject: [PolygonNewsFetcher, RssNewsFetcher, CryptoNewsFetcher, XInfluencerFetcher],
    },

    // ── Services ────────────────────────────────────────────────────
    NewsFetcherService,
    OnDemandNewsService,
    NewsSentimentService,
    NewsArchivalService,
    NewsSchedulerService,
  ],
  exports: [
    CryptoNewsApiClient,
    NewsFetcherService,
    OnDemandNewsService,
    NewsSentimentService,
    NewsArchivalService,
  ],
})
export class NewsModule {}
