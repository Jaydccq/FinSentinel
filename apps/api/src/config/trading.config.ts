import { registerAs } from '@nestjs/config';

export const tradingConfig = registerAs('trading', () => ({
  defaultMode: (process.env['APP_TRADING_DEFAULT_MODE'] || 'PAPER') as
    | 'PAPER'
    | 'LIVE',

  alpaca: {
    apiKey: process.env['ALPACA_API_KEY'],
    secretKey: process.env['ALPACA_SECRET_KEY'],
    baseUrl:
      process.env['ALPACA_BASE_URL'] ||
      'https://paper-api.alpaca.markets',
  },

  okx: {
    enabled: process.env['APP_OKX_ENABLED'] === 'true',
    apiKey: process.env['OKX_API_KEY'],
    secretKey: process.env['OKX_SECRET_KEY'],
    passphrase: process.env['OKX_PASSPHRASE'],
    sandbox: process.env['OKX_SANDBOX'] === 'true',
  },
}));
