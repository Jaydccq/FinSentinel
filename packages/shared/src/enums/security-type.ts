export const SecurityType = {
  STOCK: 'STOCK',
  OPTION: 'OPTION',
  FUTURE: 'FUTURE',
  CRYPTO: 'CRYPTO',
  PERP: 'PERP',
  FOREX: 'FOREX',
} as const;

export type SecurityType = (typeof SecurityType)[keyof typeof SecurityType];

/** Returns true if the security type is crypto-related (CRYPTO or PERP). */
export function isCrypto(secType: SecurityType): boolean {
  return secType === SecurityType.CRYPTO || secType === SecurityType.PERP;
}
