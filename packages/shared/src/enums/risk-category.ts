export const RiskCategory = {
  MARKET: 'MARKET',
  LIQUIDITY: 'LIQUIDITY',
  POLICY: 'POLICY',
  CONCENTRATION: 'CONCENTRATION',
  VOLATILITY: 'VOLATILITY',
} as const;

export type RiskCategory = (typeof RiskCategory)[keyof typeof RiskCategory];
