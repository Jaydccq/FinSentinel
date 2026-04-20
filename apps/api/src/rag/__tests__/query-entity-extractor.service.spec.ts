// apps/api/src/rag/__tests__/query-entity-extractor.service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

describe('QueryEntityExtractorService (LLM fallback)', () => {
  it('invokes LLM when regex is empty and flag is on', async () => {
    const llm = { complete: vi.fn().mockResolvedValue(JSON.stringify({
      tickers: [],
      issuerNames: [{ value: 'Nvidia', confidence: 0.9 }],
      sectors: [{ value: 'Semiconductors', confidence: 0.85 }],
      regions: [],
      docType: null,
      timeRange: null,
    })) };
    const service = new QueryEntityExtractorService({
      llmFallbackEnabled: true, llmClient: llm,
      hardMinConfidence: 0.85, timeoutMs: 1500, concurrency: 4,
    });

    const result = await service.extract('the chip supplier story');
    expect(result.issuerNames).toEqual([{ value: 'Nvidia', confidence: 0.9 }]);
    expect(result.sectors).toEqual([{ value: 'Semiconductors', confidence: 0.85 }]);
    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(result.fallbackFlag).toBeUndefined();
  });

  it('opens the circuit after 3 consecutive failures', async () => {
    const llm = { complete: vi.fn().mockRejectedValue(new Error('429')) };
    const service = new QueryEntityExtractorService({
      llmFallbackEnabled: true, llmClient: llm,
      hardMinConfidence: 0.85, timeoutMs: 1500, concurrency: 4,
    });

    // 3 triggering calls
    for (let i = 0; i < 3; i++) {
      const r = await service.extract('no tickers here ' + i);
      expect(r.fallbackFlag).toBe('llm_error');
    }

    // 4th call should short-circuit without calling the LLM
    const guarded = await service.extract('another query without regex hits');
    expect(guarded.fallbackFlag).toBe('llm_circuit_open');
    expect(llm.complete).toHaveBeenCalledTimes(3);
  });

  it('returns llm_timeout flag when LLM exceeds timeoutMs', async () => {
    const llm = { complete: () => new Promise<string>(() => { /* never resolves */ }) };
    const service = new QueryEntityExtractorService({
      llmFallbackEnabled: true, llmClient: llm,
      hardMinConfidence: 0.85, timeoutMs: 50, concurrency: 4,
    });

    const result = await service.extract('plain query without regex hits');
    expect(result.fallbackFlag).toBe('llm_timeout');
  });

  it('returns llm_empty flag when LLM response fails zod parse', async () => {
    const llm = { complete: vi.fn().mockResolvedValue('{"tickers":"not-an-array"}') };
    const service = new QueryEntityExtractorService({
      llmFallbackEnabled: true, llmClient: llm,
      hardMinConfidence: 0.85, timeoutMs: 1500, concurrency: 4,
    });

    const result = await service.extract('query without regex hits');
    expect(result.fallbackFlag).toBe('llm_empty');
  });

  it('does NOT call LLM when regex already has a hit', async () => {
    const llm = { complete: vi.fn() };
    const service = new QueryEntityExtractorService({
      llmFallbackEnabled: true, llmClient: llm,
      hardMinConfidence: 0.85, timeoutMs: 1500, concurrency: 4,
    });

    await service.extract('AAPL 10-K FY2024');
    expect(llm.complete).not.toHaveBeenCalled();
  });
});
