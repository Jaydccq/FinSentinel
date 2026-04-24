import { Injectable, Logger, Inject } from '@nestjs/common';
import type { StorageService } from './interfaces/storage-service';

/**
 * Hybrid storage service — hot (RustFS) + cold (Google Drive) fallback.
 *
 * - upload: delegates to hot storage only
 * - download: tries hot storage first, falls back to cold storage
 * - delete: calls both storages (best-effort, failures logged but not thrown)
 */
@Injectable()
export class HybridStorageService implements StorageService {
  private readonly logger = new Logger(HybridStorageService.name);

  constructor(
    @Inject('HOT_STORAGE') private readonly hotStorage: StorageService,
    @Inject('COLD_STORAGE') private readonly coldStorage: StorageService,
  ) {}

  async upload(key: string, content: Buffer, contentType: string): Promise<void> {
    await this.hotStorage.upload(key, content, contentType);
  }

  async download(key: string): Promise<Buffer> {
    try {
      return await this.hotStorage.download(key);
    } catch {
      this.logger.warn(`Hot storage miss for ${key}, falling back to cold storage`);
      return this.coldStorage.download(key);
    }
  }

  async delete(key: string): Promise<void> {
    // Best-effort delete from both tiers
    const results = await Promise.allSettled([
      this.hotStorage.delete(key),
      this.coldStorage.delete(key),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(`Best-effort delete failed for ${key}: ${result.reason}`);
      }
    }
  }

  async head(key: string): Promise<boolean> {
    // Hot-first: same ordering as download(). If the hot side returns
    // true we short-circuit; if false or throws, consult cold as a
    // fallback (today this is always false via the stub). Errors from
    // either side propagate so the reconciler doesn't misclassify
    // transient network failures as "missing object".
    try {
      if (await this.hotStorage.head(key)) return true;
    } catch (err) {
      this.logger.warn(`Hot storage head() failed for ${key}: ${err}`);
      throw err;
    }
    return this.coldStorage.head(key);
  }
}
