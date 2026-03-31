import { registerAs } from '@nestjs/config';

export const fmpConfig = registerAs('fmp', () => ({
  enabled: process.env['FMP_ENABLED'] === 'true',
  apiKey: process.env['FMP_API_KEY'],
  baseUrl:
    process.env['FMP_BASE_URL'] ||
    'https://financialmodelingprep.com/api/v3',
}));
