import { Module } from '@nestjs/common';
import { RustfsStorageService } from './rustfs.storage';
import { HybridStorageService } from './hybrid.storage';
import { GoogleDriveStorageService } from './google-drive.storage';

/**
 * Storage module -- Phase 11.
 *
 * Provides:
 * - RustfsStorageService — S3-compatible hot storage (RustFS/MinIO)
 * - GoogleDriveStorageService — Google Drive cold storage (stub until configured)
 * - HybridStorageService — hot + cold fallback
 */
@Module({
  providers: [
    RustfsStorageService,
    GoogleDriveStorageService,
    {
      provide: 'HOT_STORAGE',
      useExisting: RustfsStorageService,
    },
    {
      provide: 'COLD_STORAGE',
      useExisting: GoogleDriveStorageService,
    },
    HybridStorageService,
  ],
  exports: [RustfsStorageService, GoogleDriveStorageService, HybridStorageService],
})
export class StorageModule {}
