import { describe, it, expect } from 'vitest';
import { orderDraftSchema, orderDraftsPayloadSchema } from '../schemas/order-draft';

describe('orderDraftSchema', () => {
  const validDraft = {
    draftId: '7b6f9f40-9d2e-49a7-a2ae-42a0c0c1f5c3',
    portfolioIntent: 'OPEN',
    assetType: 'EQUITY',
    symbol: 'AAPL',
    side: 'BUY',
    quantity: { mode: 'SHARES', value: 100 },
    orderType: 'MARKET',
    limitPrice: null,
    stopPrice: null,
    timeInForce: 'DAY',
    thesisRef: 'artifact-1',
    riskRef: 'artifact-2',
    maxSlippageBps: 50,
    maxPositionPercent: 5,
    brokerConstraints: { allowFractional: false, extendedHours: false },
    approvalRequired: true,
    warnings: [],
  };

  it('accepts a fully populated v1 draft', () => {
    expect(orderDraftSchema.parse(validDraft)).toEqual(validDraft);
  });

  it('rejects broker-specific fields that leak into the draft', () => {
    const leaked = { ...validDraft, alpacaAccountId: 'abc' };
    expect(() => orderDraftSchema.strict().parse(leaked)).toThrow();
  });

  it('rejects an invalid portfolioIntent', () => {
    const bad = { ...validDraft, portfolioIntent: 'LONG' };
    expect(() => orderDraftSchema.parse(bad)).toThrow();
  });

  it('requires approvalRequired === true (v1 invariant)', () => {
    const bad = { ...validDraft, approvalRequired: false };
    expect(() => orderDraftSchema.parse(bad)).toThrow();
  });

  it('payload wrapper accepts an array of drafts', () => {
    expect(
      orderDraftsPayloadSchema.parse({ orderDrafts: [validDraft] }),
    ).toEqual({ orderDrafts: [validDraft] });
  });
});
