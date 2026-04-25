import { registerAs } from '@nestjs/config';

export const tradingConfig = registerAs('trading', () => ({
  defaultMode: (process.env['APP_TRADING_DEFAULT_MODE'] || 'PAPER') as 'PAPER' | 'LIVE',

  // Item 4 M3: when true, UnifiedTradingService.execute() persists wallet via
  // engine.getCashAsString() / getPositionMapsAsStrings() so Decimal precision
  // survives the engine ↔ wallet round-trip. Default OFF — flag-off behavior
  // is byte-identical to the M2-shipped engine path.
  // See docs/exec-plans/2026-04-24-decimal-money-migration.md §10.
  decimalExecuteEnabled: process.env['TRADING_DECIMAL_EXECUTE_ENABLED'] === 'true',

  // Item 3 M2: when true, execute() switches from the legacy GETDEL +
  // wallet.commitHistory path to the order_ledger-backed state machine
  // (STAGED → COMMITTED → EXECUTING → EXECUTED / PARTIALLY_FAILED / FAILED).
  // Default OFF — this flips the system of record and needs human signoff
  // before flag-on rollout.
  // See docs/exec-plans/2026-04-24-trading-order-ledger-state-machine.md §12.
  stateMachineEnabled: process.env['TRADING_STATE_MACHINE_ENABLED'] === 'true',

  alpaca: {
    apiKey: process.env['ALPACA_API_KEY'],
    secretKey: process.env['ALPACA_SECRET_KEY'],
    baseUrl: process.env['ALPACA_BASE_URL'] || 'https://paper-api.alpaca.markets',
  },

  okx: {
    enabled: process.env['APP_OKX_ENABLED'] === 'true',
    apiKey: process.env['OKX_API_KEY'],
    secretKey: process.env['OKX_SECRET_KEY'],
    passphrase: process.env['OKX_PASSPHRASE'],
    sandbox: process.env['OKX_SANDBOX'] === 'true',
  },
}));

export type TradingRuntimeConfig = ReturnType<typeof tradingConfig>;
