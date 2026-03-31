import { registerAs } from '@nestjs/config';

export const storageConfig = registerAs('storage', () => ({
  provider: (process.env['STORAGE_PROVIDER'] || 'rustfs') as
    | 'rustfs'
    | 'google-drive'
    | 'hybrid',
  endpoint: process.env['STORAGE_ENDPOINT'],
  accessKey: process.env['STORAGE_ACCESS_KEY'],
  secretKey: process.env['STORAGE_SECRET_KEY'],
  bucket: process.env['STORAGE_BUCKET'],
  region: process.env['STORAGE_REGION'],

  googleDrive: {
    clientId: process.env['GOOGLE_DRIVE_CLIENT_ID'],
    clientSecret: process.env['GOOGLE_DRIVE_CLIENT_SECRET'],
    refreshToken: process.env['GOOGLE_DRIVE_REFRESH_TOKEN'],
    applicationName:
      process.env['GOOGLE_DRIVE_APPLICATION_NAME'] || 'FinSentinel',
    rootFolderId: process.env['GOOGLE_DRIVE_ROOT_FOLDER_ID'],
  },
}));
