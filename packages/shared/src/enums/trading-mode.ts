export const TradingMode = {
  PAPER: 'PAPER',
  LIVE: 'LIVE',
} as const;

export type TradingMode = (typeof TradingMode)[keyof typeof TradingMode];
