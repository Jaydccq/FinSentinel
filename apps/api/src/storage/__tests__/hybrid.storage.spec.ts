import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { HybridStorageService } from '../hybrid.storage';
import type { StorageService } from '../interfaces/storage-service';

// ── Mock Storage Services ──────────────────────────────────────────────────
function createMockStorage(): StorageService & {
  upload: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(Buffer.from('test content')),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('HybridStorageService', () => {
  let service: HybridStorageService;
  let hotStorage: ReturnType<typeof createMockStorage>;
  let coldStorage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    hotStorage = createMockStorage();
    coldStorage = createMockStorage();

    const module = await Test.createTestingModule({
      providers: [
        HybridStorageService,
        { provide: 'HOT_STORAGE', useValue: hotStorage },
        { provide: 'COLD_STORAGE', useValue: coldStorage },
      ],
    }).compile();

    service = module.get(HybridStorageService);
  });

  // ── Test: upload delegates to hot ────────────────────────────────────────

  it('upload delegates to hot storage', async () => {
    const content = Buffer.from('report.pdf');

    await service.upload('docs/report.pdf', content, 'application/pdf');

    expect(hotStorage.upload).toHaveBeenCalledWith('docs/report.pdf', content, 'application/pdf');
    expect(coldStorage.upload).not.toHaveBeenCalled();
  });

  // ── Test: download fallback ──────────────────────────────────────────────

  it('download falls back to cold when hot fails', async () => {
    const coldContent = Buffer.from('archived content');
    hotStorage.download.mockRejectedValueOnce(new Error('Not found in hot'));
    coldStorage.download.mockResolvedValueOnce(coldContent);

    const result = await service.download('docs/old-report.pdf');

    expect(result).toEqual(coldContent);
    expect(hotStorage.download).toHaveBeenCalledWith('docs/old-report.pdf');
    expect(coldStorage.download).toHaveBeenCalledWith('docs/old-report.pdf');
  });

  // ── Test: delete calls both ──────────────────────────────────────────────

  it('delete calls both storages', async () => {
    await service.delete('docs/report.pdf');

    expect(hotStorage.delete).toHaveBeenCalledWith('docs/report.pdf');
    expect(coldStorage.delete).toHaveBeenCalledWith('docs/report.pdf');
  });

  it('delete succeeds even if one storage fails', async () => {
    hotStorage.delete.mockRejectedValueOnce(new Error('Hot delete failed'));

    // Should not throw
    await service.delete('docs/report.pdf');

    expect(hotStorage.delete).toHaveBeenCalledWith('docs/report.pdf');
    expect(coldStorage.delete).toHaveBeenCalledWith('docs/report.pdf');
  });
});
