import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ragConfig } from '../rag.config';

describe('ragConfig.parser', () => {
  const orig = { ...process.env };
  beforeEach(() => { process.env = { ...orig }; });
  afterEach(() => { process.env = { ...orig }; });

  it('defaults match R5.3 spec', () => {
    delete process.env['PARSER_URL'];
    delete process.env['RAG_PARSER_TIMEOUT_MS'];
    delete process.env['RAG_PARSER_MIN_MARKDOWN_CHARS'];
    delete process.env['RAG_UPLOAD_MAX_BYTES'];
    const cfg = ragConfig();
    expect(cfg.parser.url).toBe('http://localhost:8110');
    expect(cfg.parser.timeoutMs).toBe(30_000);
    expect(cfg.parser.minMarkdownChars).toBe(50);
    expect(cfg.parser.uploadMaxBytes).toBe(100 * 1024 * 1024);
  });

  it('respects env overrides', () => {
    process.env['PARSER_URL'] = 'http://parser:8110';
    process.env['RAG_PARSER_TIMEOUT_MS'] = '5000';
    process.env['RAG_PARSER_MIN_MARKDOWN_CHARS'] = '10';
    process.env['RAG_UPLOAD_MAX_BYTES'] = '52428800';
    const cfg = ragConfig();
    expect(cfg.parser.url).toBe('http://parser:8110');
    expect(cfg.parser.timeoutMs).toBe(5000);
    expect(cfg.parser.minMarkdownChars).toBe(10);
    expect(cfg.parser.uploadMaxBytes).toBe(52_428_800);
  });
});
