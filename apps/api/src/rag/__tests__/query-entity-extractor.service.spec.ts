// apps/api/src/rag/__tests__/query-entity-extractor.service.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { QueryEntityExtractorService } from '../query-entity-extractor.service';

describe('QueryEntityExtractorService (regex path)', () => {
  let service: QueryEntityExtractorService;

  beforeEach(() => {
    // No LLM fallback in this suite; pass null as the LLM client.
    service = new QueryEntityExtractorService({
      llmFallbackEnabled: false,
      llmClient: null,
      hardMinConfidence: 0.85,
      timeoutMs: 1500,
      concurrency: 4,
    });
  });

  it('extracts ticker from whitelisted all-caps token', async () => {
    const result = await service.extract('show me AAPL 10-K for 2024');
    expect(result.tickers).toEqual([{ value: 'AAPL', confidence: 0.95 }]);
    expect(result.docType).toEqual({ value: '10-K', confidence: 0.9 });
    expect(result.timeRange?.after).toBeInstanceOf(Date);
  });

  it('returns llm_disabled flag when regex produces no hits and LLM fallback is off', async () => {
    const result = await service.extract('what is going on with the market');
    expect(result.tickers).toEqual([]);
    expect(result.docType).toBeUndefined();
    // llmFallbackEnabled is false -> fallbackFlag = 'llm_disabled' by spec
    expect(result.fallbackFlag).toBe('llm_disabled');
  });

  it('rejects 2-letter all-caps tokens that are not in the whitelist', async () => {
    const result = await service.extract('CEO commentary on IT spend');
    expect(result.tickers).toEqual([]);
  });
});
