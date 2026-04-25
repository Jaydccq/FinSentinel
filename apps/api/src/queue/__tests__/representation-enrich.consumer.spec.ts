import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RepresentationEnrichConsumer } from '../representation-enrich.consumer';
import {
  ChunkRepresentationService,
  ChunkNotFoundError,
} from '../../rag/chunk-representation.service';
import type { Job } from 'bullmq';
import type { RepresentationEnrichJobData } from '../representation-enrich.producer';

// ── Helpers ────────────────────────────────────────────────────────────────────

function createMockRepresentationService() {
  return {
    enrichChunk: vi.fn().mockResolvedValue({
      chunkId: 'chunk-uuid-1',
      status: 'succeeded',
      representationsWritten: 4,
    }),
  };
}

function createMockJob(data: RepresentationEnrichJobData): Job<RepresentationEnrichJobData> {
  return { data, id: 'job-1', attemptsMade: 0 } as unknown as Job<RepresentationEnrichJobData>;
}

async function buildConsumer(
  service: ReturnType<typeof createMockRepresentationService>,
  concurrency = 4,
) {
  const module = await Test.createTestingModule({
    providers: [
      RepresentationEnrichConsumer,
      { provide: 'BULLMQ_CONNECTION', useValue: { host: 'localhost', port: 6379 } },
      { provide: ChunkRepresentationService, useValue: service },
      {
        provide: ConfigService,
        useValue: {
          get: vi.fn().mockImplementation((key: string, defaultVal: unknown) => {
            if (key === 'RAG_REPRESENTATION_CONCURRENCY') return concurrency;
            return defaultVal;
          }),
        },
      },
    ],
  }).compile();

  return module.get(RepresentationEnrichConsumer);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RepresentationEnrichConsumer', () => {
  let mockService: ReturnType<typeof createMockRepresentationService>;
  let consumer: RepresentationEnrichConsumer;

  beforeEach(async () => {
    mockService = createMockRepresentationService();
    consumer = await buildConsumer(mockService);
    // Do NOT call onModuleInit — it would try to connect to Redis.
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('calls ChunkRepresentationService.enrichChunk with the correct chunkId', async () => {
    const job = createMockJob({ chunkId: 'chunk-uuid-1' });

    await consumer.process(job);

    expect(mockService.enrichChunk).toHaveBeenCalledOnce();
    expect(mockService.enrichChunk).toHaveBeenCalledWith('chunk-uuid-1');
  });

  it('completes without throwing when enrichment succeeds', async () => {
    const job = createMockJob({ chunkId: 'chunk-uuid-1' });

    await expect(consumer.process(job)).resolves.toBeUndefined();
  });

  it('completes without throwing when enrichment status is skipped', async () => {
    mockService.enrichChunk.mockResolvedValue({
      chunkId: 'chunk-uuid-1',
      status: 'skipped',
      representationsWritten: 0,
      reason: 'already enriched at current version',
    });

    const job = createMockJob({ chunkId: 'chunk-uuid-1' });

    await expect(consumer.process(job)).resolves.toBeUndefined();
  });

  it('does not throw when enrichment fails for a non-circuit-breaker reason', async () => {
    mockService.enrichChunk.mockResolvedValue({
      chunkId: 'chunk-uuid-1',
      status: 'failed',
      representationsWritten: 0,
      reason: 'LLM response parse failed after 2 attempts',
    });

    const job = createMockJob({ chunkId: 'chunk-uuid-1' });

    // Non-retryable failures are logged but do not throw (BullMQ marks as failed, no retry)
    await expect(consumer.process(job)).resolves.toBeUndefined();
  });

  // ── Circuit breaker retryable error ───────────────────────────────────────

  it('throws a retryable error when circuit breaker is open so BullMQ re-queues', async () => {
    mockService.enrichChunk.mockResolvedValue({
      chunkId: 'chunk-uuid-1',
      status: 'failed',
      representationsWritten: 0,
      reason: 'circuit breaker open: too many consecutive 429 errors',
    });

    const job = createMockJob({ chunkId: 'chunk-uuid-1' });

    await expect(consumer.process(job)).rejects.toThrow(/circuit breaker open/);
  });

  // ── ChunkNotFoundError: re-throw so BullMQ retries ────────────────────────

  it('re-throws ChunkNotFoundError so BullMQ retries', async () => {
    mockService.enrichChunk.mockRejectedValue(new ChunkNotFoundError('chunk-uuid-missing'));

    const job = createMockJob({ chunkId: 'chunk-uuid-missing' });

    await expect(consumer.process(job)).rejects.toThrow(ChunkNotFoundError);
    await expect(consumer.process(job)).rejects.toThrow('chunk not found: chunk-uuid-missing');
  });

  // ── Service throws unexpectedly ────────────────────────────────────────────

  it('propagates unexpected errors so BullMQ handles retries', async () => {
    mockService.enrichChunk.mockRejectedValue(new Error('unexpected DB failure'));

    const job = createMockJob({ chunkId: 'chunk-uuid-1' });

    await expect(consumer.process(job)).rejects.toThrow('unexpected DB failure');
  });
});
