import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PolygonNewsFetcher } from '../fetchers/polygon-news.fetcher';

// ── Constants ──────────────────────────────────────────────────────────────

const API_KEY = 'test-polygon-key';

const SAMPLE_POLYGON_RESPONSE = {
  results: [
    {
      id: 'poly-001',
      title: 'AAPL beats Q1 earnings expectations',
      description: 'Apple reported stronger-than-expected results...',
      article_url: 'https://polygon.io/news/poly-001',
      author: 'Jane Doe',
      published_utc: '2026-03-30T14:00:00Z',
      tickers: ['AAPL'],
      image_url: 'https://polygon.io/images/poly-001.jpg',
      keywords: ['earnings', 'tech'],
    },
    {
      id: 'poly-002',
      title: 'TSLA rallies on delivery numbers',
      description: null,
      article_url: 'https://polygon.io/news/poly-002',
      author: null,
      published_utc: '2026-03-30T12:00:00Z',
      tickers: ['TSLA'],
      keywords: [],
    },
  ],
  status: 'OK',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockConfigService(): ConfigService {
  const config: Record<string, string> = {
    POLYGON_API_KEY: API_KEY,
  };

  return {
    get: vi.fn((key: string, defaultValue?: string) => config[key] ?? defaultValue ?? ''),
  } as unknown as ConfigService;
}

function createEmptyConfigService(): ConfigService {
  return {
    get: vi.fn((_key: string, defaultValue?: string) => defaultValue ?? ''),
  } as unknown as ConfigService;
}

function mockFetchSuccess(responseBody: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(responseBody),
    status: 200,
    statusText: 'OK',
  });
}

function mockFetchError(status: number, statusText: string, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    text: vi.fn().mockResolvedValue(body),
  });
}

describe('PolygonNewsFetcher', () => {
  let fetcher: PolygonNewsFetcher;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PolygonNewsFetcher,
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    fetcher = module.get(PolygonNewsFetcher);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── getSource ──────────────────────────────────────────────────────────

  it('getSource returns POLYGON', () => {
    expect(fetcher.getSource()).toBe('POLYGON');
  });

  // ── fetch with valid API key ──────────────────────────────────────────

  it('fetches and maps articles from Polygon API', async () => {
    fetchMock = mockFetchSuccess(SAMPLE_POLYGON_RESPONSE);
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetcher.fetch(['AAPL']);

    expect(items).toHaveLength(2);

    // First article — fully populated
    expect(items[0]).toEqual({
      sourceId: 'poly-001',
      source: 'POLYGON',
      title: 'AAPL beats Q1 earnings expectations',
      summary: 'Apple reported stronger-than-expected results...',
      articleUrl: 'https://polygon.io/news/poly-001',
      author: 'Jane Doe',
      publishedAt: '2026-03-30T14:00:00Z',
      tickers: ['AAPL'],
      tags: ['earnings', 'tech'],
    });

    // Second article — nullish fields handled
    expect(items[1]).toEqual({
      sourceId: 'poly-002',
      source: 'POLYGON',
      title: 'TSLA rallies on delivery numbers',
      summary: null,
      articleUrl: 'https://polygon.io/news/poly-002',
      author: null,
      publishedAt: '2026-03-30T12:00:00Z',
      tickers: ['TSLA'],
      tags: [],
    });
  });

  // ── URL construction ──────────────────────────────────────────────────

  it('includes ticker param in URL when tickers provided', async () => {
    fetchMock = mockFetchSuccess({ results: [] });
    vi.stubGlobal('fetch', fetchMock);

    await fetcher.fetch(['AAPL', 'TSLA']);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('ticker=AAPL%2CTSLA');
    expect(url).toContain('limit=10');
    expect(url).toContain(`apiKey=${API_KEY}`);
  });

  it('omits ticker param when no tickers provided', async () => {
    fetchMock = mockFetchSuccess({ results: [] });
    vi.stubGlobal('fetch', fetchMock);

    await fetcher.fetch([]);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain('ticker=');
  });

  // ── Error handling ────────────────────────────────────────────────────

  it('throws on non-OK response', async () => {
    fetchMock = mockFetchError(429, 'Too Many Requests', 'Rate limit exceeded');
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetcher.fetch(['AAPL'])).rejects.toThrow(
      'Polygon news API returned 429: Rate limit exceeded',
    );
  });

  // ── Empty results ─────────────────────────────────────────────────────

  it('returns empty array when no results', async () => {
    fetchMock = mockFetchSuccess({ results: [] });
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetcher.fetch(['AAPL']);
    expect(items).toEqual([]);
  });

  it('handles missing results field', async () => {
    fetchMock = mockFetchSuccess({ status: 'OK' });
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetcher.fetch(['AAPL']);
    expect(items).toEqual([]);
  });

  // ── No API key ────────────────────────────────────────────────────────

  it('returns empty array when API key is not set', async () => {
    const module = await Test.createTestingModule({
      providers: [
        PolygonNewsFetcher,
        { provide: ConfigService, useValue: createEmptyConfigService() },
      ],
    }).compile();

    const noKeyFetcher = module.get(PolygonNewsFetcher);
    const items = await noKeyFetcher.fetch(['AAPL']);

    expect(items).toEqual([]);
  });
});
