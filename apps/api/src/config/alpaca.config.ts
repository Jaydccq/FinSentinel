import { registerAs } from '@nestjs/config';

export const alpacaConfig = registerAs('alpaca', () => ({
  enabled: process.env['ALPACA_ENABLED'] === 'true',
  apiKey: process.env['ALPACA_API_KEY'],
  secretKey: process.env['ALPACA_SECRET_KEY'],
  baseUrl:
    process.env['ALPACA_BASE_URL'] || 'https://paper-api.alpaca.markets',
}));
