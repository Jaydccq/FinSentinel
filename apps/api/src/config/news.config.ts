import { registerAs } from '@nestjs/config';

export const newsConfig = registerAs('news', () => ({
  polling: {
    enabled: process.env['NEWS_POLLING_ENABLED'] !== 'false',
    intervalMs: Number(process.env['NEWS_POLL_INTERVAL_MS']) || 300000,
    startupDelayMs: Number(process.env['NEWS_POLL_STARTUP_DELAY_MS']) || 10000,
  },
}));
