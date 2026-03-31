import { registerAs } from '@nestjs/config';

export const archivalConfig = registerAs('archival', () => ({
  enabled: process.env['ARCHIVAL_ENABLED'] === 'true',
  retentionDays: Number(process.env['ARCHIVAL_RETENTION_DAYS']) || 7,
  cron: process.env['ARCHIVAL_CRON'] || '0 0 2 * * *',
  batchSize: Number(process.env['ARCHIVAL_BATCH_SIZE']) || 50,
}));
