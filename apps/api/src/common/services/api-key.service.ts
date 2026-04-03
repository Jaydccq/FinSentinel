import { Injectable, Inject, Logger } from '@nestjs/common';
import { apiKeys, eq, and } from '@finsentinel/db';
import { EncryptionService } from './encryption.service';

/**
 * Known API key names that the settings UI enumerates.
 */
export const KNOWN_KEY_NAMES = [
  'POLYGON',
  'OPENROUTER',
  'FMP',
  'FIRECRAWL',
  'OKX_API_KEY',
  'OKX_SECRET_KEY',
  'OKX_PASSPHRASE',
  'ALPACA_API_KEY',
  'ALPACA_SECRET_KEY',
] as const;

export type KnownKeyName = (typeof KNOWN_KEY_NAMES)[number];

export interface ApiKeyStatus {
  name: string;
  configured: boolean;
}

/**
 * Manages encrypted API key storage, retrieval, and lifecycle operations.
 *
 * Keys are encrypted with AES-256-GCM before persistence. Each encryption
 * uses a unique IV, ensuring identical plaintext values produce different
 * ciphertexts.
 *
 * API-key lifecycle management for user-scoped provider credentials.
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * Encrypts and saves (or updates) an API key for the given user.
   *
   * Uses an upsert (INSERT ... ON CONFLICT DO UPDATE) so that re-saving
   * a key with the same name for the same user replaces the value atomically.
   *
   * @param userId - the owning user's UUID
   * @param name - the key identifier (e.g. 'POLYGON', 'OPENROUTER')
   * @param value - the plaintext API key value
   */
  async save(userId: string, name: string, value: string): Promise<void> {
    const { ciphertext, iv } = this.encryptionService.encrypt(value);

    await this.db
      .insert(apiKeys)
      .values({
        userId,
        keyName: name,
        encryptedValue: ciphertext,
        iv,
      })
      .onConflictDoUpdate({
        target: [apiKeys.userId, apiKeys.keyName],
        set: {
          encryptedValue: ciphertext,
          iv,
          updatedAt: new Date(),
        },
      });

    this.logger.log(`API key '${name}' saved for user ${userId}`);
  }

  /**
   * Decrypts and returns the stored API key value.
   *
   * @param userId - the owning user's UUID
   * @param name - the key identifier
   * @returns the decrypted value, or null if not found
   */
  async get(userId: string, name: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.keyName, name)))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return this.encryptionService.decrypt(row.encryptedValue, row.iv);
  }

  /**
   * Deletes a stored API key.
   *
   * @param userId - the owning user's UUID
   * @param name - the key identifier
   */
  async delete(userId: string, name: string): Promise<void> {
    await this.db
      .delete(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.keyName, name)));

    this.logger.log(`API key '${name}' deleted for user ${userId}`);
  }

  /**
   * Returns the configuration status of all known API keys for the user.
   *
   * For each known key name, returns whether it is configured in the database.
   *
   * @param userId - the owning user's UUID
   * @returns array of status entries for all known keys
   */
  async listStatus(userId: string): Promise<ApiKeyStatus[]> {
    const stored: Array<{ keyName: string }> = await this.db
      .select({ keyName: apiKeys.keyName })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId));

    const configuredNames = new Set(stored.map((row) => row.keyName));

    return KNOWN_KEY_NAMES.map((name) => ({
      name,
      configured: configuredNames.has(name),
    }));
  }
}
