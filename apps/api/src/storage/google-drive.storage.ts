import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorageService } from './interfaces/storage-service';

/**
 * Google Drive storage service — cold tier.
 *
 * Implements the StorageService interface for Google Drive API v3.
 * Uses OAuth2 with a refresh token for authentication.
 *
 * Current implementation is a stub that logs operations. The actual
 * Google Drive integration will be wired when the googleapis
 * dependency is added.
 *
 * Config (from storage.config.ts → googleDrive):
 * - GOOGLE_DRIVE_CLIENT_ID
 * - GOOGLE_DRIVE_CLIENT_SECRET
 * - GOOGLE_DRIVE_REFRESH_TOKEN
 * - GOOGLE_DRIVE_APPLICATION_NAME (default: FinSentinel)
 * - GOOGLE_DRIVE_ROOT_FOLDER_ID
 */
@Injectable()
export class GoogleDriveStorageService implements StorageService {
  private readonly logger = new Logger(GoogleDriveStorageService.name);
  private readonly applicationName: string;
  private readonly rootFolderId: string | undefined;
  private readonly configured: boolean;

  constructor(configService: ConfigService) {
    const clientId = configService.get<string>('storage.googleDrive.clientId');
    const clientSecret = configService.get<string>('storage.googleDrive.clientSecret');
    const refreshToken = configService.get<string>('storage.googleDrive.refreshToken');
    this.applicationName = configService.get<string>(
      'storage.googleDrive.applicationName',
      'FinSentinel',
    );
    this.rootFolderId = configService.get<string>('storage.googleDrive.rootFolderId');

    this.configured = !!(clientId && clientSecret && refreshToken);

    if (!this.configured) {
      this.logger.warn(
        'Google Drive storage is not configured — operations will be no-ops. ' +
          'Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN.',
      );
    } else {
      this.logger.log(
        `Google Drive storage initialized: app=${this.applicationName}, ` +
          `rootFolder=${this.rootFolderId ?? '(root)'}`,
      );
    }
  }

  /**
   * Upload a file to Google Drive.
   *
   * Stub: logs the operation. Real implementation would use
   * googleapis `drive.files.create` with resumable upload.
   */
  async upload(key: string, content: Buffer, contentType: string): Promise<void> {
    if (!this.configured) {
      this.logger.debug(`[STUB] upload skipped (not configured): ${key}`);
      return;
    }

    // TODO: Implement actual Google Drive upload
    // 1. Parse key into folder path + filename
    // 2. Create/find folder hierarchy under rootFolderId
    // 3. Upload file with drive.files.create({ media: { body, mimeType } })
    this.logger.debug(
      `[STUB] Would upload to Google Drive: key=${key}, ` +
        `size=${content.length} bytes, type=${contentType}`,
    );
  }

  /**
   * Download a file from Google Drive.
   *
   * Stub: throws an error (cold storage miss).
   * Real implementation would use `drive.files.get` with `alt=media`.
   */
  async download(key: string): Promise<Buffer> {
    if (!this.configured) {
      throw new Error(`Google Drive not configured — cannot download: ${key}`);
    }

    // TODO: Implement actual Google Drive download
    // 1. Search for file by name/path in rootFolderId
    // 2. Download with drive.files.get({ fileId, alt: 'media' })
    // 3. Return buffer
    throw new Error(`Google Drive download not yet implemented: ${key}`);
  }

  /**
   * Delete a file from Google Drive.
   *
   * Stub: logs the operation.
   * Real implementation would use `drive.files.delete`.
   */
  async delete(key: string): Promise<void> {
    if (!this.configured) {
      this.logger.debug(`[STUB] delete skipped (not configured): ${key}`);
      return;
    }

    // TODO: Implement actual Google Drive delete
    // 1. Search for file by name/path
    // 2. drive.files.delete({ fileId })
    this.logger.debug(`[STUB] Would delete from Google Drive: ${key}`);
  }

  /** Check if Google Drive credentials are configured. */
  isConfigured(): boolean {
    return this.configured;
  }

  /**
   * Stub head() — always reports missing. The cold tier hasn't wired up
   * real Google Drive calls yet (see class docstring), so the F-4
   * reconciler effectively treats the cold tier as empty. Once the
   * real Drive integration lands, replace this with a `drive.files.list`
   * existence query.
   */
  async head(_key: string): Promise<boolean> {
    return false;
  }
}
