import { describe, it, expect } from 'vitest';
import { OrderDraftMapper } from '../order-draft-mapper.service';

const draft = {
  draftId: '33333333-3333-3333-3333-333333333333',
  portfolioIntent: 'OPEN' as const,
  assetType: 'EQUITY' as const,
  symbol: 'AAPL',
  side: 'BUY' as const,
  quantity: { mode: 'SHARES' as const, value: 100 },
  orderType: 'MARKET' as const,
  limitPrice: null,
  stopPrice: null,
  timeInForce: 'DAY' as const,
  thesisRef: 't',
  riskRef: 'r',
  maxSlippageBps: 50,
  maxPositionPercent: 5,
  brokerConstraints: { allowFractional: false, extendedHours: false },
  approvalRequired: true as const,
  warnings: [],
};

describe('OrderDraftMapper.toUnifiedStageRequest', () => {
  const m = new OrderDraftMapper();

  it('maps SHARES quantity to qty string', () => {
    const out = m.toUnifiedStageRequest(draft);
    expect(out).toMatchObject({ action: 'BUY', symbol: 'AAPL', qty: '100' });
    expect(out.amount).toBeUndefined();
  });

  it('maps NOTIONAL_USD quantity to amount', () => {
    const out = m.toUnifiedStageRequest({
      ...draft,
      quantity: { mode: 'NOTIONAL_USD', value: 1000 },
    });
    expect(out).toMatchObject({ amount: '1000' });
    expect(out.qty).toBeUndefined();
  });

  it('rejects unsupported modes (PERCENT_NAV is v2 scope)', () => {
    expect(() =>
      m.toUnifiedStageRequest({
        ...draft,
        quantity: { mode: 'PERCENT_NAV', value: 5 },
      }),
    ).toThrow(/PERCENT_NAV/);
  });
});
