import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import request from 'supertest';
import { TradingController } from '../trading.controller';
import { UnifiedTradingService } from '../unified-trading.service';
import { JwtGuard } from '../../auth/jwt.guard';

// ── Constants ──────────────────────────────────────────────────────────────
const USER_ID = '11111111-1111-1111-1111-111111111111';
const WALLET_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const COMMIT_HASH = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

// ── Mock UnifiedTradingService ────────────────────────────────────────────
const mockTradingService = {
  stage: vi.fn(),
  getStagingArea: vi.fn(),
  getStagedStructured: vi.fn(),
  commit: vi.fn(),
  execute: vi.fn(),
  getOrCreateWallet: vi.fn(),
  getWalletStatus: vi.fn(),
  getWalletStatusStructured: vi.fn(),
  getCommitLog: vi.fn(),
  getCommitLogStructured: vi.fn(),
  switchMode: vi.fn(),
  searchAssets: vi.fn(),
};

// ── Fake JwtGuard ─────────────────────────────────────────────────────────
const fakeJwtGuard = {
  canActivate: (context: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
    const req = context.switchToHttp().getRequest();
    req['user'] = { userId: USER_ID, username: 'testuser' };
    return true;
  },
};

describe('TradingController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [TradingController],
      providers: [{ provide: UnifiedTradingService, useValue: mockTradingService }],
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

  // ═══════════════════════════════════════════════════════════════════════════
  // v1 Endpoints
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/trading/stage', () => {
    it('stages a trade and returns message', async () => {
      mockTradingService.stage.mockResolvedValueOnce(1);

      const res = await request(app.getHttpServer())
        .post('/api/trading/stage')
        .send({ action: 'BUY', ticker: 'AAPL', shares: '10' })
        .expect(201);

      expect(res.body.message).toContain('Staged BUY AAPL');
      expect(mockTradingService.stage).toHaveBeenCalledWith(USER_ID, {
        action: 'BUY',
        symbol: 'AAPL',
        qty: '10',
        amount: undefined,
      });
    });

    it('returns 400 for invalid action', async () => {
      await request(app.getHttpServer())
        .post('/api/trading/stage')
        .send({ action: 'HOLD', ticker: 'AAPL' })
        .expect(400);
    });

    it('returns 400 for missing ticker', async () => {
      await request(app.getHttpServer())
        .post('/api/trading/stage')
        .send({ action: 'BUY' })
        .expect(400);
    });
  });

  describe('GET /api/trading/staged', () => {
    it('returns staged operations', async () => {
      const ops = [{ action: 'BUY', symbol: 'AAPL', qty: '10' }];
      mockTradingService.getStagingArea.mockResolvedValueOnce(ops);

      const res = await request(app.getHttpServer()).get('/api/trading/staged').expect(200);

      expect(res.body).toEqual(ops);
    });
  });

  describe('POST /api/trading/commit', () => {
    it('commits staged operations', async () => {
      mockTradingService.commit.mockResolvedValueOnce({
        hash: COMMIT_HASH,
        count: 2,
      });

      const res = await request(app.getHttpServer())
        .post('/api/trading/commit')
        .send({ message: 'Buy tech stocks' })
        .expect(201);

      expect(res.body.message).toContain('Committed 2 operations');
      expect(res.body.message).toContain('abcdef12');
    });

    it('returns 400 for empty message', async () => {
      await request(app.getHttpServer())
        .post('/api/trading/commit')
        .send({ message: '' })
        .expect(400);
    });
  });

  describe('POST /api/trading/execute', () => {
    it('executes and returns report', async () => {
      mockTradingService.execute.mockResolvedValueOnce({
        report: 'Executed commit abcdef12... (1 ops)\n[OK] BUY AAPL: qty=10 @ $175.00',
        commitData: {},
        results: [],
      });

      const res = await request(app.getHttpServer()).post('/api/trading/execute').expect(201);

      expect(res.body.message).toContain('Executed commit');
    });

    it('returns 400 when no pending commit', async () => {
      mockTradingService.execute.mockRejectedValueOnce(
        new BadRequestException('No pending commit found.'),
      );

      await request(app.getHttpServer()).post('/api/trading/execute').expect(400);
    });
  });

  describe('GET /api/trading/wallet', () => {
    it('returns wallet status', async () => {
      mockTradingService.getOrCreateWallet.mockResolvedValueOnce({
        id: WALLET_ID,
        userId: USER_ID,
        initialCapital: '100000.00',
        cashBalance: '95000.00',
        tradingMode: 'PAPER',
        positions: [{ ticker: 'AAPL', shares: 10, avgCost: 175, currentPrice: 180 }],
        commitHistory: [],
      });

      const res = await request(app.getHttpServer()).get('/api/trading/wallet').expect(200);

      expect(res.body.cashBalance).toBe('95000.00');
      expect(res.body.tradingMode).toBe('PAPER');
      expect(res.body.initialCapital).toBe('100000.00');
    });
  });

  describe('GET /api/trading/history', () => {
    it('returns commit log with default limit', async () => {
      mockTradingService.getCommitLog.mockResolvedValueOnce('1. [abcdef12] Buy AAPL');

      const res = await request(app.getHttpServer()).get('/api/trading/history').expect(200);

      expect(res.body.history).toBe('1. [abcdef12] Buy AAPL');
      expect(mockTradingService.getCommitLog).toHaveBeenCalledWith(USER_ID, 10);
    });

    it('respects limit parameter capped at 50', async () => {
      mockTradingService.getCommitLog.mockResolvedValueOnce('log');

      await request(app.getHttpServer()).get('/api/trading/history?limit=100').expect(200);

      expect(mockTradingService.getCommitLog).toHaveBeenCalledWith(USER_ID, 50);
    });
  });

  describe('PUT /api/trading/mode', () => {
    it('switches trading mode', async () => {
      mockTradingService.switchMode.mockResolvedValueOnce(undefined);

      const res = await request(app.getHttpServer())
        .put('/api/trading/mode')
        .send({ mode: 'LIVE' })
        .expect(200);

      expect(res.body.message).toContain('LIVE');
      expect(mockTradingService.switchMode).toHaveBeenCalledWith(USER_ID, 'LIVE');
    });

    it('returns 400 for invalid mode', async () => {
      await request(app.getHttpServer())
        .put('/api/trading/mode')
        .send({ mode: 'INVALID' })
        .expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // v2 UTA Endpoints
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/trading/v2/stage', () => {
    it('stages with unified request', async () => {
      mockTradingService.stage.mockResolvedValueOnce(1);

      const res = await request(app.getHttpServer())
        .post('/api/trading/v2/stage')
        .send({ action: 'BUY', symbol: 'AAPL', qty: '10' })
        .expect(201);

      expect(res.body.count).toBe(1);
      expect(res.body.message).toContain('BUY AAPL');
    });
  });

  describe('POST /api/trading/v2/commit', () => {
    it('commits and returns hash + count', async () => {
      mockTradingService.commit.mockResolvedValueOnce({
        hash: COMMIT_HASH,
        count: 1,
      });

      const res = await request(app.getHttpServer())
        .post('/api/trading/v2/commit')
        .send({ message: 'Portfolio rebalance' })
        .expect(201);

      expect(res.body.hash).toBe(COMMIT_HASH);
      expect(res.body.count).toBe(1);
    });
  });

  describe('GET /api/trading/v2/wallet', () => {
    it('returns structured wallet response', async () => {
      const walletResponse = {
        cashBalance: '95000.00',
        initialCapital: '100000.00',
        totalValue: '96800.00',
        returnPercent: '-3.20',
        tradingMode: 'PAPER',
        positions: [],
      };
      mockTradingService.getWalletStatusStructured.mockResolvedValueOnce(walletResponse);

      const res = await request(app.getHttpServer()).get('/api/trading/v2/wallet').expect(200);

      expect(res.body).toEqual(walletResponse);
    });
  });

  describe('GET /api/trading/v2/history', () => {
    it('returns structured commit history', async () => {
      const history = [
        {
          hash: COMMIT_HASH,
          parentHash: '',
          message: 'Buy AAPL',
          timestamp: '2026-03-30T12:00:00.000Z',
          operations: [{ action: 'BUY', symbol: 'AAPL', qty: '10', amount: '', price: '' }],
          results: [],
        },
      ];
      mockTradingService.getCommitLogStructured.mockResolvedValueOnce(history);

      const res = await request(app.getHttpServer()).get('/api/trading/v2/history').expect(200);

      expect(res.body).toEqual(history);
    });
  });

  describe('GET /api/trading/v2/staged', () => {
    it('returns structured staged operations', async () => {
      const staged = { operations: [], count: 0 };
      mockTradingService.getStagedStructured.mockResolvedValueOnce(staged);

      const res = await request(app.getHttpServer()).get('/api/trading/v2/staged').expect(200);

      expect(res.body).toEqual(staged);
    });
  });

  describe('GET /api/trading/v2/search', () => {
    it('returns search results', async () => {
      const results = [
        { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', assetType: 'EQUITY' },
      ];
      mockTradingService.searchAssets.mockResolvedValueOnce(results);

      const res = await request(app.getHttpServer())
        .get('/api/trading/v2/search?query=AAPL')
        .expect(200);

      expect(res.body).toEqual(results);
      expect(mockTradingService.searchAssets).toHaveBeenCalledWith(USER_ID, 'AAPL');
    });

    it('returns empty array for missing query', async () => {
      const res = await request(app.getHttpServer()).get('/api/trading/v2/search').expect(200);

      expect(res.body).toEqual([]);
      expect(mockTradingService.searchAssets).not.toHaveBeenCalled();
    });
  });
});
