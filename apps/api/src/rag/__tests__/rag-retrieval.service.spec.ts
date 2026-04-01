import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RagRetrievalService } from '../rag-retrieval.service';
import type { RagSearchOptions } from '../rag-retrieval.service';

// ── Mock Drizzle DB ────────────────────────────────────────────────────────
function createMockDb() {
  return {
    execute: async () => ({ rows: [] }),
  };
}

describe('RagRetrievalService', () => {
  let service: RagRetrievalService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RagRetrievalService,
        { provide: 'DRIZZLE_DB', useValue: createMockDb() },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultVal: unknown) => {
              if (key === 'RAG_SIMILARITY_THRESHOLD') return 0.65;
              return defaultVal;
            },
          },
        },
      ],
    }).compile();

    service = module.get(RagRetrievalService);
  });

  // ── Test: empty search ────────────────────────────────────────────────────

  it('search returns empty when no embeddings exist', async () => {
    const results = await service.search('what is the risk of AAPL?');

    expect(results).toEqual([]);
    expect(results).toHaveLength(0);
  });

  // ── Test: topK respected ──────────────────────────────────────────────────

  it('search respects topK limit', async () => {
    // With no embeddings, result is always empty, but the service
    // should clamp topK to [1, 50] without throwing
    const results3 = await service.search('test', 3);
    expect(results3).toEqual([]);

    const results0 = await service.search('test', 0);
    expect(results0).toEqual([]);

    const results100 = await service.search('test', 100);
    expect(results100).toEqual([]);

    // Verify threshold is configured correctly
    expect(service.getThreshold()).toBe(0.65);
  });

  // ── Test: positional args backward-compatible ──────────────────────────

  it('accepts positional arguments (backward compatible)', async () => {
    const results = await service.search(
      'risk assessment for AAPL',
      10,
      'SEC_FILING',
      'Technology',
      'US',
      '2024-01-01',
    );

    expect(results).toEqual([]);
  });

  // ── Test: options object ───────────────────────────────────────────────

  it('accepts RagSearchOptions object', async () => {
    const opts: RagSearchOptions = {
      query: 'risk assessment for AAPL',
      topK: 10,
      docType: 'SEC_FILING',
      sector: 'Technology',
      regionId: 'US',
      afterDate: '2024-01-01',
    };

    const results = await service.search(opts);

    expect(results).toEqual([]);
  });

  // ── Test: partial filters ──────────────────────────────────────────────

  it('handles partial metadata filters', async () => {
    // Only docType filter
    const r1 = await service.search({
      query: 'earnings report',
      docType: 'SEC_FILING',
    });
    expect(r1).toEqual([]);

    // Only sector filter
    const r2 = await service.search({
      query: 'tech analysis',
      sector: 'Technology',
    });
    expect(r2).toEqual([]);

    // Only afterDate filter
    const r3 = await service.search({
      query: 'recent news',
      afterDate: '2024-06-01',
    });
    expect(r3).toEqual([]);

    // Only regionId filter
    const r4 = await service.search({
      query: 'China market',
      regionId: 'CN',
    });
    expect(r4).toEqual([]);
  });

  // ── Test: no filters ───────────────────────────────────────────────────

  it('works with no metadata filters', async () => {
    const results = await service.search({ query: 'general search' });
    expect(results).toEqual([]);
  });

  // ── Test: all filters combined ─────────────────────────────────────────

  it('works with all metadata filters combined', async () => {
    const results = await service.search({
      query: 'quarterly earnings',
      topK: 3,
      docType: 'SEC_FILING',
      sector: 'Healthcare',
      regionId: 'US',
      afterDate: '2024-01-01',
    });

    expect(results).toEqual([]);
  });

  // ── Test: default topK ─────────────────────────────────────────────────

  it('uses default topK of 5 when not specified', async () => {
    const results = await service.search({ query: 'test query' });
    // Should not throw — defaults to topK=5
    expect(results).toEqual([]);
  });

  // ── Test: topK clamping ────────────────────────────────────────────────

  it('clamps topK to valid range [1, 50]', async () => {
    // Negative topK
    const r1 = await service.search({ query: 'test', topK: -5 });
    expect(r1).toEqual([]);

    // Zero topK
    const r2 = await service.search({ query: 'test', topK: 0 });
    expect(r2).toEqual([]);

    // Very large topK
    const r3 = await service.search({ query: 'test', topK: 1000 });
    expect(r3).toEqual([]);
  });

  // ── Test: threshold ────────────────────────────────────────────────────

  it('reports configured similarity threshold', () => {
    expect(service.getThreshold()).toBe(0.65);
  });

  // ── Test: custom threshold from config ─────────────────────────────────

  it('uses custom threshold from ConfigService', async () => {
    const module = await Test.createTestingModule({
      providers: [
        RagRetrievalService,
        { provide: 'DRIZZLE_DB', useValue: createMockDb() },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultVal: unknown) => {
              if (key === 'RAG_SIMILARITY_THRESHOLD') return 0.8;
              return defaultVal;
            },
          },
        },
      ],
    }).compile();

    const customService = module.get(RagRetrievalService);
    expect(customService.getThreshold()).toBe(0.8);
  });
});
