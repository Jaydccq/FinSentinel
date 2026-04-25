import { registerAs } from '@nestjs/config';

export const tradingConfig = registerAs('trading', () => ({
  defaultMode: (process.env['APP_TRADING_DEFAULT_MODE'] || 'PAPER') as 'PAPER' | 'LIVE',

  // Item 4 M3 / item 3 M2 feature flags. Schema validation lives in
  // apps/api/src/config/env.validation.ts; we read the same env vars here
  // so the runtime config object exposes booleans to consumers without an
  // extra string-cast everywhere. Default behavior (both OFF) is
  // byte-identical to pre-flag main.
  // See docs/exec-plans/2026-04-24-decimal-money-migration.md §10
  // and docs/exec-plans/2026-04-24-trading-order-ledger-state-machine.md §12.
  decimalExecuteEnabled: process.env['TRADING_DECIMAL_EXECUTE_ENABLED'] === 'true',
  stateMachineEnabled: process.env['TRADING_STATE_MACHINE_ENABLED'] === 'true',

  // Item 3 M3 — ledger reconciler. Default OFF; required ON before flipping
  // stateMachineEnabled in production.
  reconcilerEnabled: process.env['TRADING_LEDGER_RECONCILER_ENABLED'] === 'true',
  reconcilerStaleAfterMs: Number(process.env['TRADING_LEDGER_RECONCILER_STALE_AFTER_MS'] ?? 60_000),

  // Item 5 — live trading guards.
  liveGuardsEnabled: process.env['TRADING_LIVE_GUARDS_ENABLED'] === 'true',
  livePerOrderNotionalUsd: Number(process.env['TRADING_LIVE_PER_ORDER_NOTIONAL_USD'] ?? 10_000),
  livePerDayNotionalUsd: Number(process.env['TRADING_LIVE_PER_DAY_NOTIONAL_USD'] ?? 50_000),

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
