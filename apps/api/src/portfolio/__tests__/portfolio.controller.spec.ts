import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, NotFoundException, ForbiddenException } from '@nestjs/common';
import request from 'supertest';
import { PortfolioController } from '../portfolio.controller';
import { PortfolioService } from '../portfolio.service';
import { PortfolioInsightsService } from '../portfolio-insights.service';
import { JwtGuard } from '../../auth/jwt.guard';

// ── Constants ──────────────────────────────────────────────────────────────
const USER_ID = '11111111-1111-1111-1111-111111111111';
const PORTFOLIO_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const HOLDING_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const PORTFOLIO_RESPONSE = {
  id: PORTFOLIO_ID,
  name: 'Tech Growth',
  description: 'Tech portfolio',
  totalValue: '50000.00',
  holdings: [],
  createdAt: '2026-03-30T12:00:00.000Z',
};

const HOLDING_RESPONSE = {
  id: HOLDING_ID,
  symbol: 'AAPL',
  companyName: 'Apple Inc.',
  quantity: '100',
  averageCost: '150.00',
  currentPrice: '175.00',
  sector: 'Technology',
};

const ANALYTICS_RESPONSE = {
  totalMarketValue: '50000.00',
  sectorAllocation: { Technology: '50000.00' },
  hhiIndex: 10000,
  hhiClassification: 'Highly Concentrated',
  holdingWeights: [
    {
      symbol: 'AAPL',
      companyName: 'Apple Inc.',
      sector: 'Technology',
      marketValue: '50000.00',
      weightPercent: '100.00',
      unrealizedPnl: '0.00',
      pnlPercent: '0.00',
    },
  ],
  concentrationWarnings: ['AAPL represents 100.00% of portfolio (>25% threshold)'],
};

// ── Mock Services ──────────────────────────────────────────────────────────
const mockPortfolioService = {
  createPortfolio: vi.fn(),
  getPortfolios: vi.fn(),
  getPortfolio: vi.fn(),
  updatePortfolio: vi.fn(),
  deletePortfolio: vi.fn(),
  addHolding: vi.fn(),
  getHoldings: vi.fn(),
  updateHolding: vi.fn(),
  deleteHolding: vi.fn(),
  getPortfolioAnalytics: vi.fn(),
};

const INSIGHTS_RESPONSE = {
  portfolioId: PORTFOLIO_ID,
  generatedAt: '2026-04-06T00:00:00.000Z',
  freshness: 'full',
  riskScore: 42,
  riskLevel: 'LOW',
  hhiIndex: 800,
  hhiClassification: 'Well Diversified',
  topHoldingSymbol: 'AAPL',
  topHoldingWeightPercent: '20.00',
  sectorCount: 5,
  concentrationWarnings: [],
  holdingCount: 10,
  relevantEvents: [],
  priorityActions: ['Continue monitoring.'],
  narration: 'Your portfolio looks healthy.',
  narrationFailed: false,
};

const mockInsightsService = {
  getInsight: vi.fn(),
};

// ── Fake JwtGuard that injects userId ──────────────────────────────────────
const fakeJwtGuard = {
  canActivate: (context: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
    const req = context.switchToHttp().getRequest();
    req['user'] = { userId: USER_ID, username: 'testuser' };
    return true;
  },
};

describe('PortfolioController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [PortfolioController],
      providers: [
        { provide: PortfolioService, useValue: mockPortfolioService },
        { provide: PortfolioInsightsService, useValue: mockInsightsService },
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue(fakeJwtGuard)
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── POST /api/portfolios ────────────────────────────────────────────────

  describe('POST /api/portfolios', () => {
    it('returns 201 with created portfolio', async () => {
      mockPortfolioService.createPortfolio.mockResolvedValueOnce(PORTFOLIO_RESPONSE);

      const res = await request(app.getHttpServer())
        .post('/api/portfolios')
        .send({ name: 'Tech Growth', description: 'Tech portfolio' })
        .expect(201);

      expect(res.body).toEqual(PORTFOLIO_RESPONSE);
      expect(mockPortfolioService.createPortfolio).toHaveBeenCalledWith(USER_ID, {
        name: 'Tech Growth',
        description: 'Tech portfolio',
      });
    });

    it('returns 400 for invalid body (missing name)', async () => {
      await request(app.getHttpServer())
        .post('/api/portfolios')
        .send({ description: 'no name' })
        .expect(400);
    });
  });

  // ── GET /api/portfolios ─────────────────────────────────────────────────

  describe('GET /api/portfolios', () => {
    it('returns list of portfolios', async () => {
      mockPortfolioService.getPortfolios.mockResolvedValueOnce([PORTFOLIO_RESPONSE]);

      const res = await request(app.getHttpServer()).get('/api/portfolios').expect(200);

      expect(res.body).toEqual([PORTFOLIO_RESPONSE]);
      expect(mockPortfolioService.getPortfolios).toHaveBeenCalledWith(USER_ID);
    });
  });

  // ── GET /api/portfolios/:id ──────────────────────────────────────────────

  describe('GET /api/portfolios/:id', () => {
    it('returns single portfolio', async () => {
      mockPortfolioService.getPortfolio.mockResolvedValueOnce(PORTFOLIO_RESPONSE);

      const res = await request(app.getHttpServer())
        .get(`/api/portfolios/${PORTFOLIO_ID}`)
        .expect(200);

      expect(res.body).toEqual(PORTFOLIO_RESPONSE);
    });

    it('returns 404 when not found', async () => {
      mockPortfolioService.getPortfolio.mockRejectedValueOnce(
        new NotFoundException('Portfolio not found'),
      );

      await request(app.getHttpServer()).get(`/api/portfolios/${PORTFOLIO_ID}`).expect(404);
    });

    it('returns 403 when not owned by user', async () => {
      mockPortfolioService.getPortfolio.mockRejectedValueOnce(
        new ForbiddenException('Not authorized'),
      );

      await request(app.getHttpServer()).get(`/api/portfolios/${PORTFOLIO_ID}`).expect(403);
    });
  });

  // ── PUT /api/portfolios/:id ──────────────────────────────────────────────

  describe('PUT /api/portfolios/:id', () => {
    it('returns updated portfolio', async () => {
      const updated = { ...PORTFOLIO_RESPONSE, name: 'Renamed' };
      mockPortfolioService.updatePortfolio.mockResolvedValueOnce(updated);

      const res = await request(app.getHttpServer())
        .put(`/api/portfolios/${PORTFOLIO_ID}`)
        .send({ name: 'Renamed' })
        .expect(200);

      expect(res.body.name).toBe('Renamed');
    });
  });

  // ── DELETE /api/portfolios/:id ───────────────────────────────────────────

  describe('DELETE /api/portfolios/:id', () => {
    it('returns 204', async () => {
      mockPortfolioService.deletePortfolio.mockResolvedValueOnce(undefined);

      await request(app.getHttpServer()).delete(`/api/portfolios/${PORTFOLIO_ID}`).expect(204);
    });
  });

  // ── POST /api/portfolios/:portfolioId/holdings ──────────────────────────

  describe('POST /api/portfolios/:portfolioId/holdings', () => {
    it('returns 201 with created holding', async () => {
      mockPortfolioService.addHolding.mockResolvedValueOnce(HOLDING_RESPONSE);

      const res = await request(app.getHttpServer())
        .post(`/api/portfolios/${PORTFOLIO_ID}/holdings`)
        .send({
          symbol: 'AAPL',
          companyName: 'Apple Inc.',
          quantity: '100',
          averageCost: '150.00',
          sector: 'Technology',
        })
        .expect(201);

      expect(res.body).toEqual(HOLDING_RESPONSE);
    });

    it('returns 400 for invalid holding (negative quantity)', async () => {
      await request(app.getHttpServer())
        .post(`/api/portfolios/${PORTFOLIO_ID}/holdings`)
        .send({
          symbol: 'AAPL',
          quantity: '-5',
          averageCost: '150.00',
        })
        .expect(400);
    });
  });

  // ── GET /api/portfolios/:portfolioId/holdings ───────────────────────────

  describe('GET /api/portfolios/:portfolioId/holdings', () => {
    it('returns holdings list', async () => {
      mockPortfolioService.getHoldings.mockResolvedValueOnce([HOLDING_RESPONSE]);

      const res = await request(app.getHttpServer())
        .get(`/api/portfolios/${PORTFOLIO_ID}/holdings`)
        .expect(200);

      expect(res.body).toEqual([HOLDING_RESPONSE]);
    });
  });

  // ── DELETE /api/portfolios/:portfolioId/holdings/:holdingId ──────────────

  describe('DELETE /api/portfolios/:portfolioId/holdings/:holdingId', () => {
    it('returns 204', async () => {
      mockPortfolioService.deleteHolding.mockResolvedValueOnce(undefined);

      await request(app.getHttpServer())
        .delete(`/api/portfolios/${PORTFOLIO_ID}/holdings/${HOLDING_ID}`)
        .expect(204);
    });
  });

  // ── GET /api/portfolios/:id/analytics ───────────────────────────────────

  describe('GET /api/portfolios/:id/analytics', () => {
    it('returns analytics with HHI', async () => {
      mockPortfolioService.getPortfolioAnalytics.mockResolvedValueOnce(ANALYTICS_RESPONSE);

      const res = await request(app.getHttpServer())
        .get(`/api/portfolios/${PORTFOLIO_ID}/analytics`)
        .expect(200);

      expect(res.body.hhiIndex).toBe(10000);
      expect(res.body.hhiClassification).toBe('Highly Concentrated');
      expect(res.body.concentrationWarnings).toHaveLength(1);
    });
  });

  // ── GET /api/portfolios/:id/insights ───────────────────────────────────

  describe('GET /api/portfolios/:id/insights', () => {
    it('delegates to insightsService.getInsight and returns insight', async () => {
      mockInsightsService.getInsight.mockResolvedValueOnce(INSIGHTS_RESPONSE);

      const res = await request(app.getHttpServer())
        .get(`/api/portfolios/${PORTFOLIO_ID}/insights`)
        .expect(200);

      expect(mockInsightsService.getInsight).toHaveBeenCalledWith(USER_ID, PORTFOLIO_ID);
      expect(res.body.portfolioId).toBe(PORTFOLIO_ID);
      expect(res.body.freshness).toBe('full');
      expect(res.body.riskScore).toBe(42);
      expect(res.body.priorityActions).toEqual(['Continue monitoring.']);
    });
  });
});
