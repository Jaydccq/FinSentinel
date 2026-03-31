import { describe, it, expect } from 'vitest';
import {
  stageRequestSchema,
  unifiedStageRequestSchema,
  v2WalletResponseSchema,
  orderRequestSchema,
  orderResultSchema,
  accountInfoSchema,
  positionInfoSchema,
  marketClockSchema,
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

// ── Trading Engine DTO Schemas ──────────────────────────────────────────────

describe('orderRequestSchema', () => {
  const validOrder = {
    symbol: 'AAPL',
    side: 'BUY' as const,
    qty: '10',
    type: 'MARKET' as const,
  };

  it('accepts valid market order', () => {
    const result = orderRequestSchema.safeParse(validOrder);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeInForce).toBe('DAY');
    }
  });

  it('accepts valid limit order with limitPrice', () => {
    const result = orderRequestSchema.safeParse({
      ...validOrder,
      type: 'LIMIT',
      limitPrice: '150.00',
    });
    expect(result.success).toBe(true);
  });

  it('accepts SELL side', () => {
    const result = orderRequestSchema.safeParse({
      ...validOrder,
      side: 'SELL',
    });
    expect(result.success).toBe(true);
  });

  it('accepts GTC timeInForce', () => {
    const result = orderRequestSchema.safeParse({
      ...validOrder,
      timeInForce: 'GTC',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeInForce).toBe('GTC');
    }
  });

  it('accepts IOC timeInForce', () => {
    const result = orderRequestSchema.safeParse({
      ...validOrder,
      timeInForce: 'IOC',
    });
    expect(result.success).toBe(true);
  });

  it('defaults timeInForce to DAY when omitted', () => {
    const result = orderRequestSchema.safeParse({
      symbol: 'AAPL',
      side: 'BUY',
      qty: '10',
      type: 'MARKET',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeInForce).toBe('DAY');
    }
  });

  it('allows limitPrice to be omitted', () => {
    const result = orderRequestSchema.safeParse(validOrder);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limitPrice).toBeUndefined();
    }
  });

  it('rejects invalid side', () => {
    const result = orderRequestSchema.safeParse({
      ...validOrder,
      side: 'HOLD',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = orderRequestSchema.safeParse({
      ...validOrder,
      type: 'STOP',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid timeInForce', () => {
    const result = orderRequestSchema.safeParse({
      ...validOrder,
      timeInForce: 'FOK',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty symbol', () => {
    const result = orderRequestSchema.safeParse({
      ...validOrder,
      symbol: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing qty', () => {
    const result = orderRequestSchema.safeParse({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'MARKET',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing side', () => {
    const result = orderRequestSchema.safeParse({
      symbol: 'AAPL',
      qty: '10',
      type: 'MARKET',
    });
    expect(result.success).toBe(false);
  });
});

describe('orderResultSchema', () => {
  const validResult = {
    orderId: 'ord-123',
    symbol: 'AAPL',
    side: 'BUY' as const,
    qty: '10',
    filledQty: '10',
    avgPrice: '150.25',
    status: 'FILLED' as const,
    createdAt: '2026-03-31T10:00:00Z',
  };

  it('accepts valid filled order result', () => {
    const result = orderResultSchema.safeParse(validResult);
    expect(result.success).toBe(true);
  });

  it('accepts all valid statuses', () => {
    for (const status of ['NEW', 'FILLED', 'PARTIALLY_FILLED', 'CANCELLED', 'REJECTED']) {
      const result = orderResultSchema.safeParse({ ...validResult, status });
      expect(result.success).toBe(true);
    }
  });

  it('accepts SELL side', () => {
    const result = orderResultSchema.safeParse({
      ...validResult,
      side: 'SELL',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = orderResultSchema.safeParse({
      ...validResult,
      status: 'PENDING',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing orderId', () => {
    const { orderId: _, ...rest } = validResult;
    const result = orderResultSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing symbol', () => {
    const { symbol: _, ...rest } = validResult;
    const result = orderResultSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing createdAt', () => {
    const { createdAt: _, ...rest } = validResult;
    const result = orderResultSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe('accountInfoSchema', () => {
  const validAccount = {
    equity: '100000.00',
    cash: '50000.00',
    buyingPower: '150000.00',
    unrealizedPnl: '5000.00',
  };

  it('accepts valid account info', () => {
    const result = accountInfoSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
  });

  it('accepts account with dayTradeCount', () => {
    const result = accountInfoSchema.safeParse({
      ...validAccount,
      dayTradeCount: 2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dayTradeCount).toBe(2);
    }
  });

  it('allows dayTradeCount to be omitted', () => {
    const result = accountInfoSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dayTradeCount).toBeUndefined();
    }
  });

  it('rejects non-integer dayTradeCount', () => {
    const result = accountInfoSchema.safeParse({
      ...validAccount,
      dayTradeCount: 2.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing equity', () => {
    const { equity: _, ...rest } = validAccount;
    const result = accountInfoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing cash', () => {
    const { cash: _, ...rest } = validAccount;
    const result = accountInfoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing buyingPower', () => {
    const { buyingPower: _, ...rest } = validAccount;
    const result = accountInfoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing unrealizedPnl', () => {
    const { unrealizedPnl: _, ...rest } = validAccount;
    const result = accountInfoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe('positionInfoSchema', () => {
  const validPosition = {
    symbol: 'AAPL',
    qty: '100',
    avgEntryPrice: '150.00',
    currentPrice: '175.00',
    unrealizedPnl: '2500.00',
    side: 'LONG' as const,
  };

  it('accepts valid long position', () => {
    const result = positionInfoSchema.safeParse(validPosition);
    expect(result.success).toBe(true);
  });

  it('accepts valid short position', () => {
    const result = positionInfoSchema.safeParse({
      ...validPosition,
      side: 'SHORT',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid side', () => {
    const result = positionInfoSchema.safeParse({
      ...validPosition,
      side: 'NEUTRAL',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing symbol', () => {
    const { symbol: _, ...rest } = validPosition;
    const result = positionInfoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing qty', () => {
    const { qty: _, ...rest } = validPosition;
    const result = positionInfoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing avgEntryPrice', () => {
    const { avgEntryPrice: _, ...rest } = validPosition;
    const result = positionInfoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing currentPrice', () => {
    const { currentPrice: _, ...rest } = validPosition;
    const result = positionInfoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing unrealizedPnl', () => {
    const { unrealizedPnl: _, ...rest } = validPosition;
    const result = positionInfoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing side', () => {
    const { side: _, ...rest } = validPosition;
    const result = positionInfoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe('marketClockSchema', () => {
  const validClock = {
    isOpen: true,
    nextOpen: '2026-03-31T09:30:00Z',
    nextClose: '2026-03-31T16:00:00Z',
    timestamp: '2026-03-31T12:00:00Z',
  };

  it('accepts valid market clock', () => {
    const result = marketClockSchema.safeParse(validClock);
    expect(result.success).toBe(true);
  });

  it('accepts closed market', () => {
    const result = marketClockSchema.safeParse({
      ...validClock,
      isOpen: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing isOpen', () => {
    const { isOpen: _, ...rest } = validClock;
    const result = marketClockSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing nextOpen', () => {
    const { nextOpen: _, ...rest } = validClock;
    const result = marketClockSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing nextClose', () => {
    const { nextClose: _, ...rest } = validClock;
    const result = marketClockSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing timestamp', () => {
    const { timestamp: _, ...rest } = validClock;
    const result = marketClockSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean isOpen', () => {
    const result = marketClockSchema.safeParse({
      ...validClock,
      isOpen: 'yes',
    });
    expect(result.success).toBe(false);
  });
});
