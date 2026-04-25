import { registerAs } from '@nestjs/config';

export const marketProviderConfig = registerAs('marketProvider', () => ({
  defaultProvider: process.env['MARKET_DEFAULT_PROVIDER'] || 'polygon',

  yahooFinance: {
    enabled: process.env['YAHOO_FINANCE_ENABLED'] !== 'false',
    baseUrl: process.env['YAHOO_FINANCE_BASE_URL'] || 'https://query1.finance.yahoo.com',
  },
}));
