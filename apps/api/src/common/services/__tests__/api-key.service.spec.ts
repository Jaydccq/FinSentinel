import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ApiKeyService, KNOWN_KEY_NAMES } from '../api-key.service';
import { EncryptionService } from '../encryption.service';

// ── Mock Drizzle DB ──────────────────────────────────────────────────────────
function createMockDb() {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'new-id' }]),
  };
  const deleteChain = {
    where: vi.fn().mockResolvedValue([]),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };

  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    delete: vi.fn().mockReturnValue(deleteChain),
    update: vi.fn().mockReturnValue(updateChain),
    _selectChain: selectChain,
    _insertChain: insertChain,
    _deleteChain: deleteChain,
    _updateChain: updateChain,
  };
}

// ── Mock EncryptionService ───────────────────────────────────────────────────
function createMockEncryption() {
  return {
    encrypt: vi.fn().mockReturnValue({
      ciphertext: 'encrypted-value-base64',
      iv: 'iv-base64',
    }),
    decrypt: vi.fn().mockReturnValue('decrypted-plain-value'),
  };
}

const TEST_USER_ID = '11111111-2222-3333-4444-555555555555';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEncryption: ReturnType<typeof createMockEncryption>;

  beforeEach(async () => {
    mockDb = createMockDb();
    mockEncryption = createMockEncryption();

    const module = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        {
          provide: 'DRIZZLE_DB',
          useValue: mockDb,
        },
        {
          provide: EncryptionService,
          useValue: mockEncryption,
        },
      ],
    }).compile();

    service = module.get(ApiKeyService);
  });

  // ── save ─────────────────────────────────────────────────────────────────

  describe('save', () => {
    it('encrypts the value and upserts into the database', async () => {
      await service.save(TEST_USER_ID, 'POLYGON', 'pk_live_123');

      // Should encrypt the plaintext value
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('pk_live_123');

      // Should insert into the database
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb._insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_USER_ID,
          keyName: 'POLYGON',
          encryptedValue: 'encrypted-value-base64',
          iv: 'iv-base64',
        }),
      );
    });

    it('uses onConflictDoUpdate for upsert behavior', async () => {
      await service.save(TEST_USER_ID, 'OPENROUTER', 'or-key-456');

      expect(mockDb._insertChain.onConflictDoUpdate).toHaveBeenCalled();
    });
  });

  // ── get ──────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns decrypted value when key exists', async () => {
      mockDb._selectChain.limit.mockResolvedValue([
        {
          id: 'key-id',
          userId: TEST_USER_ID,
          keyName: 'POLYGON',
          encryptedValue: 'encrypted-value-base64',
          iv: 'iv-base64',
        },
      ]);

      const result = await service.get(TEST_USER_ID, 'POLYGON');

      expect(result).toBe('decrypted-plain-value');
      expect(mockEncryption.decrypt).toHaveBeenCalledWith(
        'encrypted-value-base64',
        'iv-base64',
      );
    });

    it('returns null when key does not exist', async () => {
      mockDb._selectChain.limit.mockResolvedValue([]);

      const result = await service.get(TEST_USER_ID, 'POLYGON');

      expect(result).toBeNull();
      expect(mockEncryption.decrypt).not.toHaveBeenCalled();
    });
  });

  // ── delete ───────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes the key from the database', async () => {
      await service.delete(TEST_USER_ID, 'POLYGON');

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb._deleteChain.where).toHaveBeenCalled();
    });
  });

  // ── listStatus ───────────────────────────────────────────────────────────

  describe('listStatus', () => {
    it('returns all known keys with configured=false when none stored', async () => {
      mockDb._selectChain.from.mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      });

      const statuses = await service.listStatus(TEST_USER_ID);

      expect(statuses).toHaveLength(KNOWN_KEY_NAMES.length);
      for (const status of statuses) {
        expect(status.configured).toBe(false);
        expect(KNOWN_KEY_NAMES).toContain(status.name);
      }
    });

    it('marks configured keys as true', async () => {
      mockDb._selectChain.from.mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { keyName: 'POLYGON' },
          { keyName: 'OPENROUTER' },
        ]),
      });

      const statuses = await service.listStatus(TEST_USER_ID);

      const polygon = statuses.find((s) => s.name === 'POLYGON');
      const openrouter = statuses.find((s) => s.name === 'OPENROUTER');
      const fmp = statuses.find((s) => s.name === 'FMP');

      expect(polygon?.configured).toBe(true);
      expect(openrouter?.configured).toBe(true);
      expect(fmp?.configured).toBe(false);
    });
  });

  // ── KNOWN_KEY_NAMES ──────────────────────────────────────────────────────

  describe('KNOWN_KEY_NAMES', () => {
    it('contains expected key names', () => {
      expect(KNOWN_KEY_NAMES).toContain('POLYGON');
      expect(KNOWN_KEY_NAMES).toContain('OPENROUTER');
      expect(KNOWN_KEY_NAMES).toContain('FMP');
      expect(KNOWN_KEY_NAMES).toContain('FIRECRAWL');
      expect(KNOWN_KEY_NAMES).toContain('OKX_API_KEY');
      expect(KNOWN_KEY_NAMES).toContain('OKX_SECRET_KEY');
      expect(KNOWN_KEY_NAMES).toContain('OKX_PASSPHRASE');
      expect(KNOWN_KEY_NAMES).toContain('ALPACA_API_KEY');
      expect(KNOWN_KEY_NAMES).toContain('ALPACA_SECRET_KEY');
    });
  });
});
