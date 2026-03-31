import { registerAs } from '@nestjs/config';

export const openbbConfig = registerAs('openbb', () => ({
  enabled: process.env['OPENBB_ENABLED'] === 'true',
  baseUrl: process.env['OPENBB_BASE_URL'] || 'http://localhost:6900',
  apiPrefix: process.env['OPENBB_API_PREFIX'] || '/api/v1',
  apiKey: process.env['OPENBB_API_KEY'],
}));
