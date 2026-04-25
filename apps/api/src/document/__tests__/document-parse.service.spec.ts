import { describe, it, expect, vi } from 'vitest';
import { DocumentParseService } from '../document-parse.service';
import { TextCleaningService } from '../text-cleaning.service';
import type { ParserSidecarClient } from '../parser-sidecar.client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Identity cleaner — returns the text unchanged for test isolation. */
function makeIdentityCleaner(): TextCleaningService {
  return { clean: (text: string) => text } as unknown as TextCleaningService;
}

function makeService(sidecar?: Partial<ParserSidecarClient>): DocumentParseService {
  return new DocumentParseService(
    makeIdentityCleaner(),
    (sidecar ?? null) as unknown as ParserSidecarClient,
  );
}

// ---------------------------------------------------------------------------
// parseToCleanText — existing text/json paths
// ---------------------------------------------------------------------------

describe('DocumentParseService.parseToCleanText', () => {
  it('returns UTF-8 text for text/plain', () => {
    const service = makeService();
    expect(service.parseToCleanText(Buffer.from('hello'), 'text/plain')).toBe('hello');
  });

  it('returns stringified JSON for application/json', () => {
    const service = makeService();
    const buf = Buffer.from('{"a":1}');
    const result = service.parseToCleanText(buf, 'application/json');
    expect(result).toContain('"a"');
    expect(result).toContain('1');
  });

  it('falls back to UTF-8 for unknown MIME', () => {
    const service = makeService();
    expect(service.parseToCleanText(Buffer.from('raw'), 'application/octet-stream')).toBe('raw');
  });

  // ── R5.5: PDF / DOC / DOCX must throw USE_ASYNC_PARSER_PATH ──────────────

  it('throws USE_ASYNC_PARSER_PATH on PDF in parseToCleanText', () => {
    const service = makeService();
    expect(() => service.parseToCleanText(Buffer.from('pdf'), 'application/pdf')).toThrow(
      'USE_ASYNC_PARSER_PATH',
    );
  });

  it('throws USE_ASYNC_PARSER_PATH on DOC in parseToCleanText', () => {
    const service = makeService();
    expect(() => service.parseToCleanText(Buffer.from('doc'), 'application/msword')).toThrow(
      'USE_ASYNC_PARSER_PATH',
    );
  });

  it('throws USE_ASYNC_PARSER_PATH on DOCX in parseToCleanText', () => {
    const service = makeService();
    expect(() =>
      service.parseToCleanText(
        Buffer.from('dx'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toThrow('USE_ASYNC_PARSER_PATH');
  });
});

// ---------------------------------------------------------------------------
// parseToMarkdown — R5.5
// ---------------------------------------------------------------------------

describe('DocumentParseService.parseToMarkdown', () => {
  it('delegates to ParserSidecarClient and applies text cleaning', async () => {
    const sidecar = {
      parse: vi.fn().mockResolvedValue({
        markdown: '# Title\n\nBody with lots of content to pass cleaning.',
        metadata: {
          pageCount: 1,
          headings: [],
          tableCount: 0,
          parserVersion: 'stub-0.1',
          sourceMimeType: 'application/pdf',
        },
      }),
    };

    const service = makeService(sidecar as unknown as ParserSidecarClient);
    const result = await service.parseToMarkdown(Buffer.from('pdf'), 'application/pdf', 'x.pdf');

    expect(sidecar.parse).toHaveBeenCalledTimes(1);
    expect(sidecar.parse).toHaveBeenCalledWith(expect.any(Buffer), 'application/pdf', 'x.pdf');
    expect(result).toContain('Title');
  });

  it('throws PARSER_SIDECAR_UNAVAILABLE when no sidecar injected', async () => {
    const service = makeService(); // no sidecar
    await expect(
      service.parseToMarkdown(Buffer.from('x'), 'application/pdf', 'x.pdf'),
    ).rejects.toThrow('PARSER_SIDECAR_UNAVAILABLE');
  });

  it('propagates errors thrown by the sidecar client', async () => {
    const sidecar = {
      parse: vi.fn().mockRejectedValue(new Error('PARSER_CIRCUIT_OPEN')),
    };

    const service = makeService(sidecar as unknown as ParserSidecarClient);
    await expect(
      service.parseToMarkdown(Buffer.from('pdf'), 'application/pdf', 'x.pdf'),
    ).rejects.toThrow('PARSER_CIRCUIT_OPEN');
  });
});
