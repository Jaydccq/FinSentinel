import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TwitterDataService } from '../twitter-data.service';

// ── Constants ──────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.6551.io';
const TOKEN = 'test-bearer-token';

const SAMPLE_USER = {
  id: '123456',
  username: 'elonmusk',
  name: 'Elon Musk',
  followers_count: 180_000_000,
};

const SAMPLE_TWEETS = {
  data: [
    { id: 't1', text: 'First tweet' },
    { id: 't2', text: 'Second tweet' },
  ],
};

const SAMPLE_FOLLOWERS = {
  data: [
    { id: 'f1', username: 'follower1' },
    { id: 'f2', username: 'follower2' },
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockConfigService(): ConfigService {
  const config: Record<string, string> = {
    TWITTER_6551_BASE_URL: BASE_URL,
    TWITTER_6551_TOKEN: TOKEN,
  };

  return {
    get: vi.fn((key: string, defaultValue?: string) => config[key] ?? defaultValue ?? ''),
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

describe('TwitterDataService', () => {
  let service: TwitterDataService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TwitterDataService,
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    service = module.get(TwitterDataService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── getUserInfo ─────────────────────────────────────────────────────────

  describe('getUserInfo', () => {
    it('posts to /open/twitter/user_info with username', async () => {
      fetchMock = mockFetchSuccess(SAMPLE_USER);
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.getUserInfo('elonmusk');

      expect(result).toEqual(SAMPLE_USER);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/open/twitter/user_info`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({ username: 'elonmusk' }),
        },
      );
    });
  });

  // ── getUserById ─────────────────────────────────────────────────────────

  describe('getUserById', () => {
    it('posts to /open/twitter/user_by_id with user_id', async () => {
      fetchMock = mockFetchSuccess(SAMPLE_USER);
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.getUserById('123456');

      expect(result).toEqual(SAMPLE_USER);
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/open/twitter/user_by_id`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({ user_id: '123456' }),
        },
      );
    });
  });

  // ── getUserTweets ───────────────────────────────────────────────────────

  describe('getUserTweets', () => {
    it('posts with default parameters', async () => {
      fetchMock = mockFetchSuccess(SAMPLE_TWEETS);
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.getUserTweets('elonmusk');

      expect(result).toEqual(SAMPLE_TWEETS);
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/open/twitter/user_tweets`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({
            username: 'elonmusk',
            max_results: 20,
            include_replies: false,
            include_retweets: false,
          }),
        },
      );
    });

    it('passes custom parameters', async () => {
      fetchMock = mockFetchSuccess(SAMPLE_TWEETS);
      vi.stubGlobal('fetch', fetchMock);

      await service.getUserTweets('elonmusk', 50, true, true);

      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/open/twitter/user_tweets`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({
            username: 'elonmusk',
            max_results: 50,
            include_replies: true,
            include_retweets: true,
          }),
        },
      );
    });
  });

  // ── getUserFollowers ────────────────────────────────────────────────────

  describe('getUserFollowers', () => {
    it('posts with default maxResults', async () => {
      fetchMock = mockFetchSuccess(SAMPLE_FOLLOWERS);
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.getUserFollowers('elonmusk');

      expect(result).toEqual(SAMPLE_FOLLOWERS);
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/open/twitter/user_followers`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({
            username: 'elonmusk',
            max_results: 20,
          }),
        },
      );
    });

    it('passes custom maxResults', async () => {
      fetchMock = mockFetchSuccess(SAMPLE_FOLLOWERS);
      vi.stubGlobal('fetch', fetchMock);

      await service.getUserFollowers('elonmusk', 100);

      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/open/twitter/user_followers`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({
            username: 'elonmusk',
            max_results: 100,
          }),
        },
      );
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws on non-OK response', async () => {
      fetchMock = mockFetchError(401, 'Unauthorized', 'Invalid token');
      vi.stubGlobal('fetch', fetchMock);

      await expect(service.getUserInfo('elonmusk')).rejects.toThrow(
        '6551 Twitter API returned 401: Invalid token',
      );
    });

    it('throws on 500 server error', async () => {
      fetchMock = mockFetchError(500, 'Internal Server Error', 'Something went wrong');
      vi.stubGlobal('fetch', fetchMock);

      await expect(service.getUserTweets('elonmusk')).rejects.toThrow(
        '6551 Twitter API returned 500: Something went wrong',
      );
    });
  });

  // ── Auth header ─────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('includes Bearer token in Authorization header', async () => {
      fetchMock = mockFetchSuccess({});
      vi.stubGlobal('fetch', fetchMock);

      await service.getUserInfo('test');

      const callArgs = fetchMock.mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });
  });
});
