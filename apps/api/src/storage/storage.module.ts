import { Module } from '@nestjs/common';
import { RustfsStorageService } from './rustfs.storage';
import { HybridStorageService } from './hybrid.storage';

/**
 * Storage module -- Phase 11.
 *
 * Provides:
 * - RustfsStorageService — S3-compatible hot storage (RustFS/MinIO)
 * - HybridStorageService — hot + cold fallback (cold = Google Drive, stub for now)
 *
 * The cold storage (Google Drive) provider is a no-op stub.
 * It will be replaced with a real implementation when the Google Drive
 * integration is wired.
 */

/** No-op cold storage stub until Google Drive is implemented. */
const coldStorageStub = {
  async upload() { /* no-op */ },
  async download(key: string): Promise<Buffer> {
    throw new Error(`Cold storage not available for key: ${key}`);
  },
  async delete() { /* no-op */ },
};

@Module({
  providers: [
    RustfsStorageService,
    {
      provide: 'HOT_STORAGE',
      useExisting: RustfsStorageService,
    },
    {
      provide: 'COLD_STORAGE',
      useValue: coldStorageStub,
    },
    HybridStorageService,
  ],
  exports: [RustfsStorageService, HybridStorageService],
})
export class StorageModule {}
