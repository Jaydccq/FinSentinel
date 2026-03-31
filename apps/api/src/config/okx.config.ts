import { registerAs } from '@nestjs/config';

export const okxConfig = registerAs('okx', () => ({
  enabled: process.env['APP_OKX_ENABLED'] === 'true',
  apiKey: process.env['OKX_API_KEY'],
  secretKey: process.env['OKX_SECRET_KEY'],
  passphrase: process.env['OKX_PASSPHRASE'],
  baseUrl: process.env['OKX_BASE_URL'] || 'https://www.okx.com',
  sandbox: process.env['OKX_SANDBOX'] === 'true',
  websocketEnabled: process.env['OKX_WEBSOCKET_ENABLED'] !== 'false',
  websocketUrl: process.env['OKX_WEBSOCKET_URL'],
  watchPairs: process.env['OKX_WATCH_PAIRS']?.split(',').filter(Boolean) ?? [],
  rateLimitPerSecond:
    Number(process.env['OKX_RATE_LIMIT_PER_SECOND']) || 10,
}));
