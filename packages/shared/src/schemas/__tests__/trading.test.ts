import { describe, it, expect } from 'vitest';
import {
  stageRequestSchema,
  unifiedStageRequestSchema,
  v2WalletResponseSchema,
} from '../trading';

describe('stageRequestSchema', () => {
  it('accepts valid BUY request with shares', () => {
    const result = stageRequestSchema.safeParse({
      action: 'BUY',
      ticker: 'AAPL',
      shares: '10',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid SELL request with amount', () => {
    const result = stageRequestSchema.safeParse({
      action: 'SELL',
      ticker: 'TSLA',
      amount: '5000.00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts CLOSE action', () => {
    const result = stageRequestSchema.safeParse({
      action: 'CLOSE',
      ticker: 'NVDA',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const result = stageRequestSchema.safeParse({
      action: 'HOLD',
      ticker: 'AAPL',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty action', () => {
    const result = stageRequestSchema.safeParse({
      action: '',
      ticker: 'AAPL',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty ticker', () => {
    const result = stageRequestSchema.safeParse({
      action: 'BUY',
      ticker: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing ticker', () => {
    const result = stageRequestSchema.safeParse({
      action: 'BUY',
    });
    expect(result.success).toBe(false);
  });

  it('allows shares and amount to be omitted', () => {
    const result = stageRequestSchema.safeParse({
      action: 'BUY',
      ticker: 'AAPL',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shares).toBeUndefined();
      expect(result.data.amount).toBeUndefined();
    }
  });
});

describe('unifiedStageRequestSchema', () => {
  it('accepts valid unified stage request', () => {
    const result = unifiedStageRequestSchema.safeParse({
      action: 'BUY',
      symbol: 'BTC-USD',
      qty: '0.5',
      price: '45000.00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts request with only required fields', () => {
    const result = unifiedStageRequestSchema.safeParse({
      action: 'SELL',
      symbol: 'ETH-USD',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const result = unifiedStageRequestSchema.safeParse({
      action: 'SWAP',
      symbol: 'BTC-USD',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty symbol', () => {
    const result = unifiedStageRequestSchema.safeParse({
      action: 'BUY',
      symbol: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects symbol longer than 50 chars', () => {
    const result = unifiedStageRequestSchema.safeParse({
      action: 'BUY',
      symbol: 'A'.repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it('rejects qty longer than 30 chars', () => {
    const result = unifiedStageRequestSchema.safeParse({
      action: 'BUY',
      symbol: 'BTC-USD',
      qty: '1'.repeat(31),
    });
    expect(result.success).toBe(false);
  });

  it('rejects amount longer than 30 chars', () => {
    const result = unifiedStageRequestSchema.safeParse({
      action: 'BUY',
      symbol: 'BTC-USD',
      amount: '9'.repeat(31),
    });
    expect(result.success).toBe(false);
  });

  it('rejects price longer than 30 chars', () => {
    const result = unifiedStageRequestSchema.safeParse({
      action: 'BUY',
      symbol: 'BTC-USD',
      price: '8'.repeat(31),
    });
    expect(result.success).toBe(false);
  });
});

describe('v2WalletResponseSchema', () => {
  const validWallet = {
    cashBalance: '10000.00',
    initialCapital: '50000.00',
    totalValue: '55000.00',
    returnPercent: '10.00',
    tradingMode: 'PAPER',
    positions: [
      {
        symbol: 'AAPL',
        qty: '100',
        avgCost: '150.00',
        currentPrice: '175.00',
        marketValue: '17500.00',
        unrealizedPnl: '2500.00',
        pnlPercent: '16.67',
        securityType: 'CS',
      },
    ],
  };

  it('accepts valid V2WalletResponse', () => {
    const result = v2WalletResponseSchema.safeParse(validWallet);
    expect(result.success).toBe(true);
  });

  it('accepts wallet with empty positions', () => {
    const result = v2WalletResponseSchema.safeParse({
      ...validWallet,
      positions: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts wallet with multiple positions', () => {
    const result = v2WalletResponseSchema.safeParse({
      ...validWallet,
      positions: [
        {
          symbol: 'AAPL',
          qty: '100',
          avgCost: '150.00',
          currentPrice: '175.00',
          marketValue: '17500.00',
          unrealizedPnl: '2500.00',
          pnlPercent: '16.67',
          securityType: 'CS',
        },
        {
          symbol: 'BTC-USD',
          qty: '0.5',
          avgCost: '40000.00',
          currentPrice: '45000.00',
          marketValue: '22500.00',
          unrealizedPnl: '2500.00',
          pnlPercent: '12.50',
          securityType: 'CRYPTO',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing cashBalance', () => {
    const { cashBalance: _, ...incomplete } = validWallet;
    const result = v2WalletResponseSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it('rejects missing positions', () => {
    const { positions: _, ...incomplete } = validWallet;
    const result = v2WalletResponseSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it('rejects position with missing symbol', () => {
    const result = v2WalletResponseSchema.safeParse({
      ...validWallet,
      positions: [
        {
          qty: '100',
          avgCost: '150.00',
          currentPrice: '175.00',
          marketValue: '17500.00',
          unrealizedPnl: '2500.00',
          pnlPercent: '16.67',
          securityType: 'CS',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects position with missing securityType', () => {
    const result = v2WalletResponseSchema.safeParse({
      ...validWallet,
      positions: [
        {
          symbol: 'AAPL',
          qty: '100',
          avgCost: '150.00',
          currentPrice: '175.00',
          marketValue: '17500.00',
          unrealizedPnl: '2500.00',
          pnlPercent: '16.67',
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
