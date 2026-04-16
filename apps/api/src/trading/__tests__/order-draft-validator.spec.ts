import { describe, it, expect } from 'vitest';
import { OrderDraftValidator } from '../order-draft-validator.service';

const valid = {
  draftId: '22222222-2222-2222-2222-222222222222',
  portfolioIntent: 'OPEN',
  assetType: 'EQUITY',
  symbol: 'AAPL',
  side: 'BUY',
  quantity: { mode: 'SHARES', value: 100 },
  orderType: 'MARKET',
  limitPrice: null,
  stopPrice: null,
  timeInForce: 'DAY',
  thesisRef: 'a',
  riskRef: 'b',
  maxSlippageBps: 50,
  maxPositionPercent: 5,
  brokerConstraints: { allowFractional: false, extendedHours: false },
  approvalRequired: true,
  warnings: [],
};

describe('OrderDraftValidator', () => {
  const v = new OrderDraftValidator();

  it('passes a valid payload through unchanged', () => {
    expect(v.validate({ orderDrafts: [valid] })).toEqual({ orderDrafts: [valid] });
  });

  it('rejects broker-specific leakage via strict mode', () => {
    expect(() =>
      v.validate({ orderDrafts: [{ ...valid, alpacaAccountId: 'x' } as never] }),
    ).toThrow();
  });

  it('rejects missing approvalRequired', () => {
    const bad = { ...valid, approvalRequired: false };
    expect(() => v.validate({ orderDrafts: [bad as never] })).toThrow();
  });
});
