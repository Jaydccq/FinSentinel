import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch before importing the module under test
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// We need to import chatApi after stubbing fetch so apiFetch picks it up
const { chatApi } = await import('../chat');

describe('chatApi', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('assess', () => {
    it('sends portfolioId in JSON body, not query params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ riskScore: 50, riskLevel: 'medium', summary: '', factors: [], actionableAdvice: [] }),
      });

      await chatApi.assess('hello', 'port-123', 'sess-1');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];

      // URL must NOT contain portfolioId as query param
      expect(url).not.toContain('portfolioId');
      expect(url).not.toContain('?');
      expect(url).toContain('/chat/assess');

      // Body must contain portfolioId
      const body = JSON.parse(options.body);
      expect(body).toEqual({
        message: 'hello',
        sessionId: 'sess-1',
        portfolioId: 'port-123',
      });
    });

    it('includes portfolioId as undefined in body when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ riskScore: 50, riskLevel: 'medium', summary: '', factors: [], actionableAdvice: [] }),
      });

      await chatApi.assess('hello', undefined, 'sess-1');

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).not.toContain('?');

      const body = JSON.parse(options.body);
      expect(body.message).toBe('hello');
      expect(body.sessionId).toBe('sess-1');
      // portfolioId should not appear as a query param
    });
  });

  describe('stream', () => {
    function mockSSEResponse(events: string) {
      const encoder = new TextEncoder();
      let sent = false;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () => {
              if (!sent) {
                sent = true;
                return Promise.resolve({ done: false, value: encoder.encode(events) });
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          }),
        },
      };
    }

    it('sends portfolioId in JSON body, not query params', async () => {
      const sseData = 'event:done\ndata:{}\n\n';
      mockFetch.mockResolvedValueOnce(mockSSEResponse(sseData));

      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();

      await chatApi.stream('hello', 'port-456', 'sess-2', onChunk, onDone, onError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];

      // URL must NOT contain portfolioId as query param
      expect(url).not.toContain('portfolioId');
      expect(url).not.toContain('?');
      expect(url).toMatch(/\/chat\/stream$/);

      // Body must contain portfolioId
      const body = JSON.parse(options.body);
      expect(body).toEqual({
        message: 'hello',
        sessionId: 'sess-2',
        portfolioId: 'port-456',
      });
    });

    it('does not append query params when portfolioId is undefined', async () => {
      const sseData = 'event:done\ndata:{}\n\n';
      mockFetch.mockResolvedValueOnce(mockSSEResponse(sseData));

      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();

      await chatApi.stream('hello', undefined, 'sess-3', onChunk, onDone, onError);

      const [url] = mockFetch.mock.calls[0];
      expect(url).not.toContain('?');
      expect(url).toMatch(/\/chat\/stream$/);
    });
  });
});
