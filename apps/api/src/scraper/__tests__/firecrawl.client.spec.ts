import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FirecrawlClient } from '../firecrawl.client';

// ── Mock fetch ────────────────────────────────────────────────────────────
const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

function successResponse(markdown: string) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true, data: { markdown } }),
  };
}

function errorResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    statusText: message,
    json: () => Promise.resolve({ success: false, error: message }),
  };
}

describe('FirecrawlClient', () => {
  let client: FirecrawlClient;

  beforeEach(async () => {
    mockFetch.mockReset();

    const module = await Test.createTestingModule({
      providers: [
        FirecrawlClient,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => {
              if (key === 'firecrawl.apiKey') return 'test-api-key';
              if (key === 'firecrawl.baseUrl') return 'https://api.firecrawl.dev/v2';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    client = module.get(FirecrawlClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Test: successful scrape ─────────────────────────────────────────────

  it('scrape returns markdown on success', async () => {
    mockFetch.mockResolvedValueOnce(successResponse('# AAPL 10-K Filing\n\nContent here...'));

    const result = await client.scrape('https://example.com/filing');

    expect(result).toBe('# AAPL 10-K Filing\n\nContent here...');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/scrape',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-api-key',
        },
        body: JSON.stringify({
          url: 'https://example.com/filing',
          formats: ['markdown'],
        }),
      }),
    );
  });

  // ── Test: retry on failure ──────────────────────────────────────────────

  it('retries up to 3 times on failure then throws', async () => {
    mockFetch
      .mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'))
      .mockResolvedValueOnce(errorResponse(502, 'Bad Gateway'))
      .mockResolvedValueOnce(errorResponse(503, 'Service Unavailable'));

    await expect(client.scrape('https://example.com/fail')).rejects.toThrow(
      /Firecrawl scrape failed after 3 attempts/,
    );

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // ── Test: retry succeeds on second attempt ──────────────────────────────

  it('succeeds on retry after initial failure', async () => {
    mockFetch
      .mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'))
      .mockResolvedValueOnce(successResponse('# Recovered content'));

    const result = await client.scrape('https://example.com/retry');

    expect(result).toBe('# Recovered content');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // ── Test: handles network errors ────────────────────────────────────────

  it('retries on network errors', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce(successResponse('# Finally got it'));

    const result = await client.scrape('https://example.com/flaky');

    expect(result).toBe('# Finally got it');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // ── Test: returns null when response has no markdown ────────────────────

  it('returns null when response has no markdown data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    const result = await client.scrape('https://example.com/empty');

    expect(result).toBeNull();
  });
});
