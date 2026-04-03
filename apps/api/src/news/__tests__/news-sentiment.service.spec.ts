import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NewsSentimentService } from '../news-sentiment.service';

// ── Constants ──────────────────────────────────────────────────────────────

const API_KEY = 'test-openrouter-key';
const MODEL = 'google/gemini-3-flash-preview';
const BASE_URL = 'https://openrouter.ai/api';

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockConfigService(): ConfigService {
  const config: Record<string, string> = {
    OPENROUTER_API_KEY: API_KEY,
    AI_MODEL: MODEL,
    OPENROUTER_BASE_URL: BASE_URL,
  };

  return {
    get: vi.fn((key: string, defaultValue?: string) => config[key] ?? defaultValue ?? ''),
  } as unknown as ConfigService;
}

function mockChatCompletion(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    }),
    status: 200,
    statusText: 'OK',
  });
}

function mockFetchError(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    text: vi.fn().mockResolvedValue(body),
  });
}

describe('NewsSentimentService', () => {
  let service: NewsSentimentService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        NewsSentimentService,
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    service = module.get(NewsSentimentService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Sentiment classification ──────────────────────────────────────────

  it('classifies POSITIVE sentiment', async () => {
    fetchMock = mockChatCompletion('POSITIVE');
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.classify(
      'AAPL beats earnings expectations',
      'Apple reported record revenue...',
    );

    expect(result).toBe('POSITIVE');
  });

  it('classifies NEGATIVE sentiment', async () => {
    fetchMock = mockChatCompletion('NEGATIVE');
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.classify(
      'TSLA misses delivery targets',
      'Tesla delivered fewer vehicles than expected...',
    );

    expect(result).toBe('NEGATIVE');
  });

  it('classifies NEUTRAL sentiment', async () => {
    fetchMock = mockChatCompletion('NEUTRAL');
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.classify(
      'Fed holds rates steady',
      'The Federal Reserve kept interest rates unchanged...',
    );

    expect(result).toBe('NEUTRAL');
  });

  // ── Case insensitivity ────────────────────────────────────────────────

  it('handles lowercase response by normalizing to uppercase', async () => {
    fetchMock = mockChatCompletion('positive');
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.classify('Good news', null);
    expect(result).toBe('POSITIVE');
  });

  it('handles mixed-case response', async () => {
    fetchMock = mockChatCompletion('Negative');
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.classify('Bad news', null);
    expect(result).toBe('NEGATIVE');
  });

  // ── API call construction ─────────────────────────────────────────────

  it('sends correct request to OpenRouter', async () => {
    fetchMock = mockChatCompletion('POSITIVE');
    vi.stubGlobal('fetch', fetchMock);

    await service.classify('Headline', 'Summary text');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE_URL}/v1/chat/completions`);
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe(`Bearer ${API_KEY}`);

    const body = JSON.parse(options.body);
    expect(body.model).toBe(MODEL);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].content).toContain('Headline');
    expect(body.messages[1].content).toContain('Summary text');
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(10);
  });

  it('handles title-only input (null summary)', async () => {
    fetchMock = mockChatCompletion('NEUTRAL');
    vi.stubGlobal('fetch', fetchMock);

    await service.classify('Just a headline', null);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.messages[1].content).toBe('Title: Just a headline');
    expect(body.messages[1].content).not.toContain('Summary');
  });

  // ── Edge cases & error handling ───────────────────────────────────────

  it('returns NEUTRAL for unexpected LLM response', async () => {
    fetchMock = mockChatCompletion('SOMEWHAT_POSITIVE');
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.classify('Some headline', null);
    expect(result).toBe('NEUTRAL');
  });

  it('returns NEUTRAL on API error', async () => {
    fetchMock = mockFetchError(500, 'Server error');
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.classify('Some headline', null);
    expect(result).toBe('NEUTRAL');
  });

  it('returns NEUTRAL on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await service.classify('Some headline', null);
    expect(result).toBe('NEUTRAL');
  });

  it('returns NEUTRAL on empty response', async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await service.classify('Some headline', null);
    expect(result).toBe('NEUTRAL');
  });
});
