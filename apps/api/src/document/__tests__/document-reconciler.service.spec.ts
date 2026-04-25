import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { DocumentReconcilerService } from '../document-reconciler.service';
import { HybridStorageService } from '../../storage/hybrid.storage';

// Drizzle chain shape matching other document specs.
function createMockDb(stuckRows: Array<{ id: string; storageKey: string }>) {
  const selectFrom = {
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(stuckRows),
  };
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const deleteWhere = vi.fn().mockResolvedValue(undefined);

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue(selectFrom),
    }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
    delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    _mocks: { updateSet, updateWhere, deleteWhere },
  };
}

describe('DocumentReconcilerService', () => {
  let storage: { head: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    storage = { head: vi.fn() };
  });

  async function build(
    stuck: Array<{ id: string; storageKey: string }>,
  ): Promise<{ service: DocumentReconcilerService; db: ReturnType<typeof createMockDb> }> {
    const db = createMockDb(stuck);
    const module = await Test.createTestingModule({
      providers: [
        DocumentReconcilerService,
        { provide: 'DRIZZLE_DB', useValue: db },
        { provide: HybridStorageService, useValue: storage },
      ],
    }).compile();
    return { service: module.get(DocumentReconcilerService), db };
  }

  it('promotes stuck rows whose storage key exists', async () => {
    storage.head.mockResolvedValue(true);
    const { service, db } = await build([{ id: 'doc-1', storageKey: 'documents/u/1_report.pdf' }]);

    const { promoted, deleted } = await service.runOnce();

    expect(promoted).toBe(1);
    expect(deleted).toBe(0);
    expect(db._mocks.updateSet).toHaveBeenCalledWith({ status: 'PENDING' });
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('deletes stuck rows whose storage key is missing', async () => {
    storage.head.mockResolvedValue(false);
    const { service, db } = await build([{ id: 'doc-2', storageKey: 'documents/u/2_missing.pdf' }]);

    const { promoted, deleted } = await service.runOnce();

    expect(promoted).toBe(0);
    expect(deleted).toBe(1);
    expect(db.delete).toHaveBeenCalled();
    expect(db._mocks.updateSet).not.toHaveBeenCalled();
  });

  it('skips per-row errors and continues processing the rest of the batch', async () => {
    storage.head
      .mockResolvedValueOnce(true) // doc-a → promote
      .mockRejectedValueOnce(new Error('network blip')) // doc-b → skip
      .mockResolvedValueOnce(false); // doc-c → delete
    const { service } = await build([
      { id: 'doc-a', storageKey: 'documents/u/a' },
      { id: 'doc-b', storageKey: 'documents/u/b' },
      { id: 'doc-c', storageKey: 'documents/u/c' },
    ]);

    const { promoted, deleted } = await service.runOnce();

    expect(promoted).toBe(1);
    expect(deleted).toBe(1);
  });

  it('returns zero counts + no storage calls when nothing is stuck', async () => {
    const { service } = await build([]);
    const { promoted, deleted } = await service.runOnce();
    expect(promoted).toBe(0);
    expect(deleted).toBe(0);
    expect(storage.head).not.toHaveBeenCalled();
  });
});
