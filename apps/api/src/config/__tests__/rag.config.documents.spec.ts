import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('rag.documents config', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...original };
    delete process.env.DOCUMENTS_REQUIRE_ASYNC_VECTORIZE;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('defaults requireAsyncVectorize to false (dev fallback allowed)', async () => {
    const { ragConfig } = await import('../rag.config');
    const cfg = ragConfig() as { documents: { requireAsyncVectorize: boolean } };
    expect(cfg.documents.requireAsyncVectorize).toBe(false);
  });

  it('parses DOCUMENTS_REQUIRE_ASYNC_VECTORIZE=true into true', async () => {
    process.env.DOCUMENTS_REQUIRE_ASYNC_VECTORIZE = 'true';
    vi.resetModules();
    const { ragConfig } = await import('../rag.config');
    const cfg = ragConfig() as { documents: { requireAsyncVectorize: boolean } };
    expect(cfg.documents.requireAsyncVectorize).toBe(true);
  });

  it('treats arbitrary truthy strings other than "true" as false (strict)', async () => {
    process.env.DOCUMENTS_REQUIRE_ASYNC_VECTORIZE = '1';
    vi.resetModules();
    const { ragConfig } = await import('../rag.config');
    const cfg = ragConfig() as { documents: { requireAsyncVectorize: boolean } };
    expect(cfg.documents.requireAsyncVectorize).toBe(false);
  });
});
