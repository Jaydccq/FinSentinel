import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { PortfolioService } from '../portfolio.service';

// ── Constants ──────────────────────────────────────────────────────────────
const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const PORTFOLIO_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const HOLDING_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const NOW = new Date('2026-03-30T12:00:00Z');

// ── Mock Drizzle DB ────────────────────────────────────────────────────────
// The mock DB must replicate Drizzle's chainable API:
//   db.select().from(X).where(Y).limit(N)    → select path
//   db.insert(X).values(V).returning()         → insert path
//   db.update(X).set(S).where(W).returning()   → update path
//   db.delete(X).where(W)                       → delete path
//
// We use a "call stack" approach: each call to db.select() pushes a fresh
// chain whose terminal method (.limit or .where without .limit) resolves
// from a result queue.

function createMockDb() {
  // Queue of results: each db.select() call consumes the next entry
  const selectResults: unknown[][] = [];

  function makeSelectChain(): {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  } {
    const chain = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockImplementation(() => {
      // If limit is called later, it resolves; otherwise where is terminal
      chain.limit.mockImplementation(() => {
        const result = selectResults.shift() ?? [];
        return Promise.resolve(result);
      });
      // Make where itself a thenable so await db.select().from(X).where(Y) works
      const thenableChain = {
        ...chain,
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          const result = selectResults.shift() ?? [];
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return thenableChain;
    });
    return chain;
  }

  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  const deleteChain = {
    where: vi.fn().mockResolvedValue([]),
  };

  return {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
    delete: vi.fn().mockReturnValue(deleteChain),
    _insertChain: insertChain,
    _updateChain: updateChain,
    _deleteChain: deleteChain,
    _selectResults: selectResults,
    /** Enqueue results for successive select() calls */
    enqueueSelect(...results: unknown[][]) {
      for (const r of results) {
        selectResults.push(r);
      }
    },
  };
}

describe('PortfolioService', () => {
  let service: PortfolioService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();

    const module = await Test.createTestingModule({
      providers: [
        PortfolioService,
        {
          provide: 'DRIZZLE_DB',
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get(PortfolioService);
  });

  // ── createPortfolio ─────────────────────────────────────────────────────

  describe('createPortfolio', () => {
    it('creates portfolio and returns PortfolioResponse', async () => {
      const created = {
        id: PORTFOLIO_ID,
        name: 'Tech Growth',
        description: 'Tech-heavy portfolio',
        userId: USER_ID,
        totalValue: '0',
        createdAt: NOW,
        updatedAt: NOW,
      };
      mockDb._insertChain.returning.mockResolvedValueOnce([created]);

      const result = await service.createPortfolio(USER_ID, {
        name: 'Tech Growth',
        description: 'Tech-heavy portfolio',
      });

      expect(result.id).toBe(PORTFOLIO_ID);
      expect(result.name).toBe('Tech Growth');
      expect(result.description).toBe('Tech-heavy portfolio');
      expect(result.holdings).toEqual([]);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  // ── getPortfolios ───────────────────────────────────────────────────────

  describe('getPortfolios', () => {
    it('returns only portfolios belonging to the user', async () => {
      // 1st select: portfolios for user
      mockDb.enqueueSelect([
        {
          id: PORTFOLIO_ID,
          name: 'Tech Growth',
          description: 'Tech portfolio',
          userId: USER_ID,
          totalValue: '50000',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
      // 2nd select: holdings for that portfolio
      mockDb.enqueueSelect([]);

      const result = await service.getPortfolios(USER_ID);

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(PORTFOLIO_ID);
      expect(result[0]!.name).toBe('Tech Growth');
    });
  });

  // ── getPortfolio ────────────────────────────────────────────────────────

  describe('getPortfolio', () => {
    it('throws NotFoundException when portfolio does not exist', async () => {
      // Portfolio lookup returns empty
      mockDb.enqueueSelect([]);

      await expect(service.getPortfolio(USER_ID, PORTFOLIO_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when userId does not match owner', async () => {
      // Portfolio found but owned by OTHER_USER_ID
      mockDb.enqueueSelect([
        {
          id: PORTFOLIO_ID,
          name: 'Tech Growth',
          description: 'Tech portfolio',
          userId: OTHER_USER_ID,
          totalValue: '50000',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);

      await expect(service.getPortfolio(USER_ID, PORTFOLIO_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── deletePortfolio ─────────────────────────────────────────────────────

  describe('deletePortfolio', () => {
    it('deletes portfolio after ownership check', async () => {
      // getPortfolio: portfolio lookup
      mockDb.enqueueSelect([
        {
          id: PORTFOLIO_ID,
          name: 'Tech Growth',
          description: null,
          userId: USER_ID,
          totalValue: '0',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
      // getPortfolio: holdings sub-query
      mockDb.enqueueSelect([]);

      await service.deletePortfolio(USER_ID, PORTFOLIO_ID);

      // delete called 3 times: holdings, riskReports, portfolio
      expect(mockDb.delete).toHaveBeenCalledTimes(3);
    });
  });

  // ── addHolding ──────────────────────────────────────────────────────────

  describe('addHolding', () => {
    it('inserts holding into portfolio and returns HoldingResponse', async () => {
      // getPortfolio: portfolio lookup
      mockDb.enqueueSelect([
        {
          id: PORTFOLIO_ID,
          name: 'Tech Growth',
          description: null,
          userId: USER_ID,
          totalValue: '0',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
      // getPortfolio: holdings sub-query
      mockDb.enqueueSelect([]);

      const newHolding = {
        id: HOLDING_ID,
        portfolioId: PORTFOLIO_ID,
        symbol: 'AAPL',
        companyName: 'Apple Inc.',
        quantity: '100',
        averageCost: '150.00',
        currentPrice: '175.00',
        sector: 'Technology',
        createdAt: NOW,
        updatedAt: NOW,
      };
      mockDb._insertChain.returning.mockResolvedValueOnce([newHolding]);

      const result = await service.addHolding(USER_ID, PORTFOLIO_ID, {
        symbol: 'AAPL',
        companyName: 'Apple Inc.',
        quantity: '100',
        averageCost: '150.00',
        sector: 'Technology',
      });

      expect(result.id).toBe(HOLDING_ID);
      expect(result.symbol).toBe('AAPL');
      expect(result.quantity).toBe('100');
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  // ── getPortfolioAnalytics ───────────────────────────────────────────────

  describe('getPortfolioAnalytics', () => {
    it('calculates HHI correctly', async () => {
      // getPortfolio: portfolio lookup
      mockDb.enqueueSelect([
        {
          id: PORTFOLIO_ID,
          name: 'Balanced',
          description: null,
          userId: USER_ID,
          totalValue: '0',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
      // getPortfolio: holdings sub-query (reused by analytics — no separate fetch)
      const holdingsData = [
        {
          id: 'h1',
          portfolioId: PORTFOLIO_ID,
          symbol: 'AAPL',
          companyName: 'Apple Inc.',
          quantity: '100',
          averageCost: '150.00',
          currentPrice: '150.00',
          sector: 'Technology',
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: 'h2',
          portfolioId: PORTFOLIO_ID,
          symbol: 'JNJ',
          companyName: 'Johnson & Johnson',
          quantity: '100',
          averageCost: '150.00',
          currentPrice: '150.00',
          sector: 'Healthcare',
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: 'h3',
          portfolioId: PORTFOLIO_ID,
          symbol: 'XOM',
          companyName: 'Exxon Mobil',
          quantity: '100',
          averageCost: '150.00',
          currentPrice: '150.00',
          sector: 'Energy',
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: 'h4',
          portfolioId: PORTFOLIO_ID,
          symbol: 'JPM',
          companyName: 'JPMorgan Chase',
          quantity: '100',
          averageCost: '150.00',
          currentPrice: '150.00',
          sector: 'Financials',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];
      mockDb.enqueueSelect(holdingsData);

      const result = await service.getPortfolioAnalytics(USER_ID, PORTFOLIO_ID);

      // 4 equal holdings -> each 25% -> HHI = 4 * 25^2 = 2500
      expect(result.hhiIndex).toBe(2500);
      expect(result.holdingWeights).toHaveLength(4);
      expect(parseFloat(result.holdingWeights[0]!.weightPercent)).toBeCloseTo(25, 1);
    });

    it('detects concentration warnings', async () => {
      // getPortfolio: portfolio lookup
      mockDb.enqueueSelect([
        {
          id: PORTFOLIO_ID,
          name: 'Concentrated',
          description: null,
          userId: USER_ID,
          totalValue: '0',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
      // getPortfolio: holdings sub-query (reused by analytics — no separate fetch)
      const holdingsData = [
        {
          id: 'h1',
          portfolioId: PORTFOLIO_ID,
          symbol: 'AAPL',
          companyName: 'Apple Inc.',
          quantity: '800',
          averageCost: '100.00',
          currentPrice: '100.00',
          sector: 'Technology',
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: 'h2',
          portfolioId: PORTFOLIO_ID,
          symbol: 'JNJ',
          companyName: 'Johnson & Johnson',
          quantity: '200',
          averageCost: '100.00',
          currentPrice: '100.00',
          sector: 'Healthcare',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ];
      mockDb.enqueueSelect(holdingsData);

      const result = await service.getPortfolioAnalytics(USER_ID, PORTFOLIO_ID);

      // HHI = 80^2 + 20^2 = 6400 + 400 = 6800
      expect(result.hhiIndex).toBe(6800);
      expect(result.hhiClassification).toBe('Highly Concentrated');

      // AAPL at 80% triggers warning
      expect(result.concentrationWarnings.length).toBeGreaterThan(0);
      expect(result.concentrationWarnings.some((w) => w.includes('AAPL'))).toBe(true);
      expect(result.concentrationWarnings.some((w) => w.includes('highly concentrated'))).toBe(
        true,
      );
    });
  });
});
