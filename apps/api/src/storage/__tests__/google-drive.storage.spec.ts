import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GoogleDriveStorageService } from '../google-drive.storage';

// ── Config factory ────────────────────────────────────────────────────────
function createConfigService(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    'storage.googleDrive.clientId': undefined,
    'storage.googleDrive.clientSecret': undefined,
    'storage.googleDrive.refreshToken': undefined,
    'storage.googleDrive.applicationName': 'FinSentinel',
    'storage.googleDrive.rootFolderId': undefined,
    ...overrides,
  };
  return {
    get: (key: string, defaultVal?: unknown) => defaults[key] ?? defaultVal,
  };
}

describe('GoogleDriveStorageService', () => {
  // ── Not configured (stub) ─────────────────────────────────────────────

  describe('when not configured', () => {
    let service: GoogleDriveStorageService;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          GoogleDriveStorageService,
          { provide: ConfigService, useValue: createConfigService() },
        ],
      }).compile();

      service = module.get(GoogleDriveStorageService);
    });

    it('isConfigured returns false', () => {
      expect(service.isConfigured()).toBe(false);
    });

    it('upload is a no-op when not configured', async () => {
      // Should not throw
      await service.upload('test/file.pdf', Buffer.from('content'), 'application/pdf');
    });

    it('download throws when not configured', async () => {
      await expect(service.download('test/file.pdf')).rejects.toThrow(
        'Google Drive not configured',
      );
    });

    it('delete is a no-op when not configured', async () => {
      // Should not throw
      await service.delete('test/file.pdf');
    });
  });

  // ── Configured (stub with credentials) ────────────────────────────────

  describe('when configured', () => {
    let service: GoogleDriveStorageService;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          GoogleDriveStorageService,
          {
            provide: ConfigService,
            useValue: createConfigService({
              'storage.googleDrive.clientId': 'test-client-id',
              'storage.googleDrive.clientSecret': 'test-secret',
              'storage.googleDrive.refreshToken': 'test-refresh-token',
              'storage.googleDrive.rootFolderId': 'folder-123',
            }),
          },
        ],
      }).compile();

      service = module.get(GoogleDriveStorageService);
    });

    it('isConfigured returns true', () => {
      expect(service.isConfigured()).toBe(true);
    });

    it('upload does not throw (stub)', async () => {
      await service.upload('docs/report.pdf', Buffer.from('pdf data'), 'application/pdf');
      // Stub — just verifies no error
    });

    it('download throws not-yet-implemented error', async () => {
      await expect(service.download('docs/report.pdf')).rejects.toThrow('not yet implemented');
    });

    it('delete does not throw (stub)', async () => {
      await service.delete('docs/report.pdf');
      // Stub — just verifies no error
    });
  });

  // ── StorageService interface compliance ────────────────────────────────

  it('implements StorageService interface', async () => {
    const module = await Test.createTestingModule({
      providers: [
        GoogleDriveStorageService,
        { provide: ConfigService, useValue: createConfigService() },
      ],
    }).compile();

    const service = module.get(GoogleDriveStorageService);

    // Verify all required methods exist
    expect(typeof service.upload).toBe('function');
    expect(typeof service.download).toBe('function');
    expect(typeof service.delete).toBe('function');
  });
});
