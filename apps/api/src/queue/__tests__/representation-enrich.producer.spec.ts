import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RepresentationEnrichProducer } from '../representation-enrich.producer';
import { REPRESENTATION_ENRICH_QUEUE_TOKEN } from '../queue.constants';

// ── Helpers ────────────────────────────────────────────────────────────────────

function createMockQueue() {
  return {
    add: vi.fn().mockResolvedValue(undefined),
  };
}

function createConfigService(enrichmentEnabled: boolean, maxChunksPerDoc = 2000) {
  return {
    get: vi.fn().mockImplementation((key: string, defaultVal: unknown) => {
      if (key === 'RAG_ENRICHMENT_ENABLED') return enrichmentEnabled;
      if (key === 'RAG_REPRESENTATION_MAX_CHUNKS_PER_DOC') return maxChunksPerDoc;
      return defaultVal;
    }),
  };
}

async function buildProducer(
  queue: ReturnType<typeof createMockQueue>,
  enrichmentEnabled: boolean,
  maxChunksPerDoc?: number,
) {
  const module = await Test.createTestingModule({
    providers: [
      RepresentationEnrichProducer,
      { provide: REPRESENTATION_ENRICH_QUEUE_TOKEN, useValue: queue },
      { provide: ConfigService, useValue: createConfigService(enrichmentEnabled, maxChunksPerDoc) },
    ],
  }).compile();

  return module.get(RepresentationEnrichProducer);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RepresentationEnrichProducer', () => {
  // ── Flag off: no-op ────────────────────────────────────────────────────────

  describe('when RAG_ENRICHMENT_ENABLED=false', () => {
    let producer: RepresentationEnrichProducer;
    let mockQueue: ReturnType<typeof createMockQueue>;

    beforeEach(async () => {
      mockQueue = createMockQueue();
      producer = await buildProducer(mockQueue, false);
    });

    it('enqueueChunk is a no-op', async () => {
      await producer.enqueueChunk('chunk-id-1');

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('enqueueMany is a no-op', async () => {
      await producer.enqueueMany(['chunk-id-1', 'chunk-id-2', 'chunk-id-3']);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  // ── Flag on: normal behavior ───────────────────────────────────────────────

  describe('when RAG_ENRICHMENT_ENABLED=true', () => {
    let producer: RepresentationEnrichProducer;
    let mockQueue: ReturnType<typeof createMockQueue>;

    beforeEach(async () => {
      mockQueue = createMockQueue();
      producer = await buildProducer(mockQueue, true);
    });

    it('enqueueChunk adds a job with stable jobId', async () => {
      await producer.enqueueChunk('chunk-abc-123');

      expect(mockQueue.add).toHaveBeenCalledOnce();
      expect(mockQueue.add).toHaveBeenCalledWith(
        'representation-enrich',
        { chunkId: 'chunk-abc-123' },
        expect.objectContaining({
          // Hyphen separator — BullMQ 5.71+ rejects ':' in custom Job.id.
          jobId: 'rep-enrich-chunk-abc-123',
          attempts: 3,
        }),
      );
    });

    it('enqueueMany enqueues all chunks within cap', async () => {
      await producer.enqueueMany(['chunk-1', 'chunk-2', 'chunk-3']);

      expect(mockQueue.add).toHaveBeenCalledTimes(3);
    });

    it('enqueueMany with empty array is a no-op', async () => {
      await producer.enqueueMany([]);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  // ── Per-doc chunk cap ──────────────────────────────────────────────────────

  describe('enqueueMany respects RAG_REPRESENTATION_MAX_CHUNKS_PER_DOC', () => {
    it('enqueues only the first N chunks when list exceeds cap', async () => {
      const mockQueue = createMockQueue();
      const cap = 5;
      const producer = await buildProducer(mockQueue, true, cap);

      const chunkIds = Array.from({ length: 10 }, (_, i) => `chunk-${i}`);
      await producer.enqueueMany(chunkIds);

      // Only cap (5) jobs should be enqueued
      expect(mockQueue.add).toHaveBeenCalledTimes(cap);

      // All enqueued jobs should be from the first 5
      const enqueuedChunkIds = mockQueue.add.mock.calls.map(
        (call) => (call[1] as { chunkId: string }).chunkId,
      );
      expect(enqueuedChunkIds).toEqual(chunkIds.slice(0, cap));
    });

    it('enqueues all chunks when list is exactly at cap', async () => {
      const mockQueue = createMockQueue();
      const cap = 3;
      const producer = await buildProducer(mockQueue, true, cap);

      const chunkIds = ['c1', 'c2', 'c3'];
      await producer.enqueueMany(chunkIds);

      expect(mockQueue.add).toHaveBeenCalledTimes(3);
    });
  });
});
