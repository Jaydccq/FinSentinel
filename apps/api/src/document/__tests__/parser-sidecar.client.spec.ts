// apps/api/src/document/__tests__/parser-sidecar.client.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ParserSidecarResponse, ParserSidecarClient } from '../parser-sidecar.client';
import type { ParserSidecarConfig } from '../parser-sidecar.client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wellFormedPayload() {
  return {
    markdown: '# Hello\n\nThis is content.',
    metadata: {
      pageCount: 2,
      headings: [{ level: 1 as const, text: 'Hello', pageStart: 1 }],
      tableCount: 0,
      parserVersion: '1.0.0',
      sourceMimeType: 'application/pdf',
    },
  };
}

function makeClient(overrides: Partial<ParserSidecarConfig> = {}): ParserSidecarClient {
  const config: ParserSidecarConfig = {
    url: 'http://localhost:8100',
    timeoutMs: 50,
    minMarkdownChars: 10,
    ...overrides,
  };
  return new ParserSidecarClient(config);
}

// ---------------------------------------------------------------------------
// Schema-only tests (no fetch mocking)
// ---------------------------------------------------------------------------

describe('ParserSidecarResponse schema', () => {
  it('accepts a well-formed payload', () => {
    const result = ParserSidecarResponse.parse(wellFormedPayload());
    expect(result.markdown).toBe('# Hello\n\nThis is content.');
    expect(result.metadata.pageCount).toBe(2);
    expect(result.metadata.headings).toHaveLength(1);
    expect(result.metadata.headings[0].level).toBe(1);
  });

  it('rejects empty markdown', () => {
    expect(() =>
      ParserSidecarResponse.parse({ ...wellFormedPayload(), markdown: '' }),
    ).toThrow();
  });

  it('rejects missing parserVersion', () => {
    const payload = wellFormedPayload();
    const { parserVersion: _omit, ...metaWithout } = payload.metadata;
    expect(() =>
      ParserSidecarResponse.parse({ ...payload, metadata: metaWithout }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Behavioural tests (mock global fetch)
// ---------------------------------------------------------------------------

describe('ParserSidecarClient behaviour', () => {
  beforeEach(() => {
    // Reset global fetch mock between tests
    vi.restoreAllMocks();
  });

  it('times out when sidecar never responds', async () => {
    // fetch returns a promise that never resolves (simulates hang);
    // AbortController signal is respected via the rejection path
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        // Register abort listener so that when AbortController fires, we reject
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const client = makeClient({ timeoutMs: 50 });
    await expect(
      client.parse(Buffer.from('data'), 'application/pdf', 'test.pdf'),
    ).rejects.toThrow();
  });

  it('opens circuit after 3 consecutive failures', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const client = makeClient({ timeoutMs: 200 });

    // 3 calls that all fail
    for (let i = 0; i < 3; i++) {
      await expect(
        client.parse(Buffer.from('data'), 'application/pdf', `test${i}.pdf`),
      ).rejects.toThrow('network error');
    }

    // 4th call should short-circuit without calling fetch
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    await expect(
      client.parse(Buffer.from('data'), 'application/pdf', 'test4.pdf'),
    ).rejects.toThrow('PARSER_CIRCUIT_OPEN');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when sidecar markdown is under threshold', async () => {
    const payload = {
      ...wellFormedPayload(),
      markdown: 'x', // 1 char, under minMarkdownChars: 50
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    } as unknown as Response);

    const client = makeClient({ timeoutMs: 200, minMarkdownChars: 50 });

    await expect(
      client.parse(Buffer.from('data'), 'application/pdf', 'test.pdf'),
    ).rejects.toThrow('PARSER_EMPTY_OUTPUT');
  });

  it('succeeds on happy path', async () => {
    const payload = wellFormedPayload();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    } as unknown as Response);

    const client = makeClient({ timeoutMs: 200, minMarkdownChars: 5 });

    const result = await client.parse(
      Buffer.from('data'),
      'application/pdf',
      'test.pdf',
    );

    expect(result.markdown).toBe(payload.markdown);
    expect(result.metadata.parserVersion).toBe('1.0.0');
    expect(result.metadata.sourceMimeType).toBe('application/pdf');
    expect(result.metadata.headings).toHaveLength(1);
  });
});
