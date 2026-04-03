import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { OpenbbPublicDataService } from '../openbb-public.service';
import { openbbConfig } from '../../config/openbb.config';

describe('OpenbbPublicDataService', () => {
  let service: OpenbbPublicDataService;
  let mockConfig: {
    enabled: boolean;
    baseUrl: string;
    apiPrefix: string;
    apiKey?: string;
  };

  beforeEach(async () => {
    mockConfig = {
      enabled: true,
      baseUrl: 'http://localhost:6900',
      apiPrefix: '/api/v1',
      apiKey: undefined,
    };

    const module = await Test.createTestingModule({
      providers: [
        OpenbbPublicDataService,
        {
          provide: openbbConfig.KEY,
          useFactory: () => mockConfig,
        },
      ],
    }).compile();

    service = module.get(OpenbbPublicDataService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── queryPublicData ──────────────────────────────────────────────────────

  describe('queryPublicData', () => {
    it('throws when OpenBB is disabled', async () => {
      mockConfig.enabled = false;

      await expect(
        service.queryPublicData('economy/cpi', 'fred'),
      ).rejects.toThrow('OpenBB integration is disabled');
    });

    it('throws on empty path', async () => {
      await expect(
        service.queryPublicData('', 'fred'),
      ).rejects.toThrow('Query path is required');
    });

    it('throws on path traversal', async () => {
      await expect(
        service.queryPublicData('../etc/passwd', 'fred'),
      ).rejects.toThrow('Invalid query path');
    });

    it('throws on encoded path traversal', async () => {
      await expect(
        service.queryPublicData('%2e%2e/etc/passwd', 'fred'),
      ).rejects.toThrow('Invalid query path');
    });

    it('throws on path containing query string', async () => {
      await expect(
        service.queryPublicData('economy/cpi?provider=fred', 'fred'),
      ).rejects.toThrow('Path must not include query string');
    });

    it('throws on absolute URL in path', async () => {
      await expect(
        service.queryPublicData('http://evil.com/exploit', 'fred'),
      ).rejects.toThrow('Path must be relative');
    });

    it('makes GET request to correct URL with provider', async () => {
      const responseBody = { results: [{ date: '2024-01', value: 3.1 }] };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(responseBody),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await service.queryPublicData('equity/price/quote', 'polygon', {
        symbol: 'AAPL',
      });

      expect(result).toEqual(responseBody);
      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, options] = mockFetch.mock.calls[0] ?? [];
      expect(url).toBe(
        'http://localhost:6900/api/v1/equity/price/quote?provider=polygon&symbol=AAPL',
      );
      expect(options.method).toBe('GET');
      expect(options.headers['Accept']).toBe('application/json');
    });

    it('sends Bearer token when apiKey is configured', async () => {
      mockConfig.apiKey = 'my-secret-key';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.queryPublicData('economy/cpi', 'fred');

      const [, options] = mockFetch.mock.calls[0] ?? [];
      expect(options.headers['Authorization']).toBe('Bearer my-secret-key');
      expect(options.headers['X-API-Key']).toBe('my-secret-key');
    });

    it('omits auth headers when apiKey is not configured', async () => {
      mockConfig.apiKey = undefined;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.queryPublicData('economy/cpi', 'fred');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBeUndefined();
      expect(options.headers['X-API-Key']).toBeUndefined();
    });

    it('builds URL without provider when provider is undefined', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.queryPublicData('economy/cpi');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:6900/api/v1/economy/cpi');
    });

    it('builds URL without extra params when params are empty', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.queryPublicData('economy/cpi', 'fred', {});

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:6900/api/v1/economy/cpi?provider=fred');
    });

    it('throws on non-ok HTTP response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValue('not found'),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        service.queryPublicData('economy/unknown', 'fred'),
      ).rejects.toThrow('OpenBB request failed (HTTP 404)');
    });

    it('throws on fetch network error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        service.queryPublicData('economy/cpi', 'fred'),
      ).rejects.toThrow('Failed to call OpenBB');
    });

    it('strips leading slashes from path', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.queryPublicData('///economy/cpi', 'fred');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:6900/api/v1/economy/cpi?provider=fred');
    });

    it('normalises provider to lowercase with underscores', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.queryPublicData('economy/cpi', 'Federal-Reserve');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('provider=federal_reserve');
    });

    it('handles trailing slashes on baseUrl and apiPrefix', async () => {
      mockConfig.baseUrl = 'http://localhost:6900/';
      mockConfig.apiPrefix = '/api/v1/';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await service.queryPublicData('economy/cpi', 'fred');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:6900/api/v1/economy/cpi?provider=fred');
    });
  });
});
