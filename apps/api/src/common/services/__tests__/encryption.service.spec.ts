import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { EncryptionService } from '../encryption.service';

// Generate a deterministic 32-byte AES key for tests
const TEST_AES_KEY = crypto.randomBytes(32).toString('base64');

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'ENCRYPTION_AES_KEY') return TEST_AES_KEY;
              return undefined;
            },
            getOrThrow: (key: string) => {
              if (key === 'ENCRYPTION_AES_KEY') return TEST_AES_KEY;
              throw new Error(`Missing config key: ${key}`);
            },
          },
        },
      ],
    }).compile();

    service = module.get(EncryptionService);
  });

  // ── encrypt + decrypt round-trip ─────────────────────────────────────────
  it('round-trips plaintext through encrypt/decrypt', () => {
    const plaintext = 'sk-live-abc123XYZ';
    const { ciphertext, iv } = service.encrypt(plaintext);
    const decrypted = service.decrypt(ciphertext, iv);

    expect(decrypted).toBe(plaintext);
  });

  // ── ciphertext differs from plaintext ────────────────────────────────────
  it('produces ciphertext different from plaintext', () => {
    const plaintext = 'my-secret-api-key';
    const { ciphertext } = service.encrypt(plaintext);

    expect(ciphertext).not.toBe(plaintext);
  });

  // ── unique IV per encryption ─────────────────────────────────────────────
  it('generates a unique IV for each encryption call', () => {
    const plaintext = 'same-value';
    const result1 = service.encrypt(plaintext);
    const result2 = service.encrypt(plaintext);

    expect(result1.iv).not.toBe(result2.iv);
    // Ciphertexts should also differ due to unique IVs
    expect(result1.ciphertext).not.toBe(result2.ciphertext);
  });

  // ── outputs are base64-encoded ───────────────────────────────────────────
  it('returns base64-encoded ciphertext and IV', () => {
    const { ciphertext, iv } = service.encrypt('test-value');

    // Should not throw when decoding as base64
    expect(() => Buffer.from(ciphertext, 'base64')).not.toThrow();
    expect(() => Buffer.from(iv, 'base64')).not.toThrow();

    // IV should decode to 12 bytes (96 bits)
    expect(Buffer.from(iv, 'base64').length).toBe(12);
  });

  // ── handles empty string ─────────────────────────────────────────────────
  it('encrypts and decrypts an empty string', () => {
    const { ciphertext, iv } = service.encrypt('');
    const decrypted = service.decrypt(ciphertext, iv);

    expect(decrypted).toBe('');
  });

  // ── handles Unicode ──────────────────────────────────────────────────────
  it('encrypts and decrypts Unicode text', () => {
    const plaintext = 'API-Key-with-unicode: \u00e9\u00e0\u00fc\u00f1\u4f60\u597d';
    const { ciphertext, iv } = service.encrypt(plaintext);
    const decrypted = service.decrypt(ciphertext, iv);

    expect(decrypted).toBe(plaintext);
  });

  // ── decrypt with wrong IV throws ─────────────────────────────────────────
  it('throws when decrypting with wrong IV', () => {
    const { ciphertext } = service.encrypt('secret');
    const wrongIv = crypto.randomBytes(12).toString('base64');

    expect(() => service.decrypt(ciphertext, wrongIv)).toThrow();
  });

  // ── decrypt with tampered ciphertext throws ──────────────────────────────
  it('throws when ciphertext is tampered', () => {
    const { ciphertext, iv } = service.encrypt('secret');
    // Flip a byte in the ciphertext
    const buf = Buffer.from(ciphertext, 'base64');
    buf[0] = buf[0]! ^ 0xff;
    const tampered = buf.toString('base64');

    expect(() => service.decrypt(tampered, iv)).toThrow();
  });

  // ── handles long plaintext ───────────────────────────────────────────────
  it('encrypts and decrypts long plaintext', () => {
    const plaintext = 'A'.repeat(10_000);
    const { ciphertext, iv } = service.encrypt(plaintext);
    const decrypted = service.decrypt(ciphertext, iv);

    expect(decrypted).toBe(plaintext);
  });
});
