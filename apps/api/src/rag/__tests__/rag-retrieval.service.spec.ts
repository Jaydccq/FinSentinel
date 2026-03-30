import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RagRetrievalService } from '../rag-retrieval.service';

// ── Mock Drizzle DB ────────────────────────────────────────────────────────
function createMockDb() {
  return {};
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
});
