import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

/**
 * Result of an AES-256-GCM encryption operation.
 * Both fields are Base64-encoded strings suitable for DB storage.
 */
export interface EncryptedPayload {
  /** Base64-encoded ciphertext (includes the 128-bit GCM auth tag appended by Node.js) */
  ciphertext: string;
  /** Base64-encoded 12-byte IV used for this encryption */
  iv: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag

/**
 * AES-256-GCM encryption service for securing API keys at rest.
 *
 * Uses a 256-bit key with a 12-byte random IV and 128-bit authentication tag.
 * The IV is generated fresh for each encryption operation, ensuring unique
 * ciphertexts even for identical plaintexts.
 *
 * AES-GCM encryption helpers for sensitive application secrets.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    const base64Key = configService.getOrThrow<string>('ENCRYPTION_AES_KEY');
    this.key = Buffer.from(base64Key, 'base64');

    if (this.key.length !== 32) {
      throw new Error(`ENCRYPTION_AES_KEY must decode to 32 bytes (got ${this.key.length})`);
    }
  }

  /**
   * Encrypts a plaintext string using AES-256-GCM.
   *
   * @param plaintext - the value to encrypt
   * @returns an {@link EncryptedPayload} with Base64-encoded ciphertext and IV
   */
  encrypt(plaintext: string): EncryptedPayload {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Concatenate ciphertext + authTag for transport/storage.
    const combined = Buffer.concat([encrypted, authTag]);

    return {
      ciphertext: combined.toString('base64'),
      iv: iv.toString('base64'),
    };
  }

  /**
   * Decrypts a Base64-encoded ciphertext using AES-256-GCM.
   *
   * @param ciphertext - Base64-encoded ciphertext (with appended auth tag)
   * @param base64Iv - Base64-encoded IV used during encryption
   * @returns the decrypted plaintext
   * @throws Error if decryption fails (wrong key, tampered data, etc.)
   */
  decrypt(ciphertext: string, base64Iv: string): string {
    const iv = Buffer.from(base64Iv, 'base64');
    const combined = Buffer.from(ciphertext, 'base64');

    // Split ciphertext and auth tag
    const encrypted = combined.subarray(0, combined.length - AUTH_TAG_LENGTH);
    const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return decrypted.toString('utf8');
  }
}
