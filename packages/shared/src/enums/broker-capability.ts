export const BrokerCapability = {
  SPOT_TRADING: 'SPOT_TRADING',
  MARGIN_TRADING: 'MARGIN_TRADING',
  PERPETUAL_SWAP: 'PERPETUAL_SWAP',
  FUTURES: 'FUTURES',
  OPTIONS: 'OPTIONS',
  MARKET_DATA: 'MARKET_DATA',
  ORDER_MANAGEMENT: 'ORDER_MANAGEMENT',
  SHORT_SELLING: 'SHORT_SELLING',
} as const;

export type BrokerCapability =
  (typeof BrokerCapability)[keyof typeof BrokerCapability];
