import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { DocumentVectorService } from '../document-vector.service';
import { DocumentChunkingService } from '../document-chunking.service';
import { RagEmbeddingService } from '../../rag/rag-embedding.service';
import { RagChunkStoreService } from '../../rag/rag-chunk-store.service';
import { MetricsService } from '../../common/services/metrics.service';

describe('DocumentVectorService', () => {
  let service: DocumentVectorService;
  let mockChunking: { chunk: Mock };
  let mockEmbeddingService: { embedChunks: Mock };
  let mockChunkStore: { replaceChunks: Mock };

  beforeEach(async () => {
    mockChunking = {
      chunk: vi.fn().mockReturnValue(['chunk one', 'chunk two']),
    };

    mockEmbeddingService = {
      embedChunks: vi.fn().mockResolvedValue([
        [1, 0, 0],
        [0, 1, 0],
      ]),
    };

    mockChunkStore = {
      replaceChunks: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        DocumentVectorService,
        { provide: DocumentChunkingService, useValue: mockChunking },
        { provide: RagEmbeddingService, useValue: mockEmbeddingService },
        { provide: RagChunkStoreService, useValue: mockChunkStore },
        { provide: MetricsService, useValue: { incrementCounter: vi.fn(), setGauge: vi.fn() } },
      ],
    }).compile();

    service = module.get(DocumentVectorService);
  });

  it('chunks, embeds, and stores document chunks', async () => {
    const chunkCount = await service.vectorize('doc-1', 'Long document body', {
      doc_type: 'SEC_FILING',
      sector: 'Technology',
      region_id: 'US',
      source: 'report.txt',
      date: '2026-04-02',
    });

    expect(chunkCount).toBe(2);
    expect(mockChunking.chunk).toHaveBeenCalledWith('Long document body');
    expect(mockEmbeddingService.embedChunks).toHaveBeenCalledWith(['chunk one', 'chunk two']);
    expect(mockChunkStore.replaceChunks).toHaveBeenCalledWith(
      'document',
      'doc-1',
      expect.arrayContaining([
        expect.objectContaining({
          content: 'chunk one',
          embedding: [1, 0, 0],
          metadata: expect.objectContaining({
            doc_type: 'SEC_FILING',
            source_type: 'document',
            source_id: 'doc-1',
            chunk_index: 0,
          }),
        }),
      ]),
    );
  });

  it('stores NEWS payloads under the news source type', async () => {
    await service.vectorize('news-1', 'Long news body', {
      doc_type: 'NEWS',
      sector: '',
      region_id: 'US',
      source: 'POLYGON',
      date: '2026-04-02',
    });

    expect(mockChunkStore.replaceChunks).toHaveBeenCalledWith(
      'news',
      'news-1',
      expect.any(Array),
    );
  });

  it('returns 0 and skips embedding for empty text', async () => {
    const chunkCount = await service.vectorize('doc-1', '', {
      doc_type: 'SEC_FILING',
      sector: 'Technology',
      region_id: 'US',
      source: 'report.txt',
      date: '2026-04-02',
    });

    expect(chunkCount).toBe(0);
    expect(mockEmbeddingService.embedChunks).not.toHaveBeenCalled();
    expect(mockChunkStore.replaceChunks).not.toHaveBeenCalled();
  });
});
