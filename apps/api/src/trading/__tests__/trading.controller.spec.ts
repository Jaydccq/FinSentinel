import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import request from 'supertest';
import { TradingController } from '../trading.controller';
import { UnifiedTradingService } from '../unified-trading.service';
import { OrderLedgerService } from '../order-ledger/order-ledger.service';
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

const mockOrderLedgerService = {
  findRecentByUser: vi.fn(),
  findUnknownPending: vi.fn(),
  acknowledge: vi.fn(),
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
      providers: [
        { provide: UnifiedTradingService, useValue: mockTradingService },
        { provide: OrderLedgerService, useValue: mockOrderLedgerService },
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

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/trading/ledger — read-only ledger surface (phase 1)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/trading/ledger', () => {
    it('returns recent ledger rows mapped to the wire format', async () => {
      const createdAt = new Date('2026-04-25T12:00:00Z');
      const updatedAt = new Date('2026-04-25T12:00:05Z');
      mockOrderLedgerService.findRecentByUser.mockResolvedValueOnce([
        {
          id: 'lg-1',
          userId: USER_ID,
          commitHash: COMMIT_HASH,
          idempotencyKey: null,
          status: 'EXECUTED',
          symbol: 'AAPL',
          side: 'buy',
          qty: '10',
          amount: null,
          price: '150.00',
          broker: 'paper',
          brokerOrderId: null,
          brokerRequest: {},
          brokerResponse: null,
          errorReason: null,
          createdAt,
          updatedAt,
        },
      ]);

      const res = await request(app.getHttpServer()).get('/api/trading/ledger').expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        id: 'lg-1',
        status: 'EXECUTED',
        symbol: 'AAPL',
        broker: 'paper',
        commitHash: COMMIT_HASH,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      });
      expect(mockOrderLedgerService.findRecentByUser).toHaveBeenCalledWith(USER_ID, 25);
    });

    it('clamps the limit query parameter to [1, 50]', async () => {
      mockOrderLedgerService.findRecentByUser.mockResolvedValueOnce([]);
      await request(app.getHttpServer()).get('/api/trading/ledger?limit=999').expect(200);
      expect(mockOrderLedgerService.findRecentByUser).toHaveBeenCalledWith(USER_ID, 50);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // M4 prereq (2): operator surface for UNKNOWN ledger rows
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/trading/ledger/unknown', () => {
    it('returns UNKNOWN_REQUIRES_OPERATOR_REVIEW rows pending acknowledgement', async () => {
      const updatedAt = new Date('2026-04-26T01:00:00Z');
      mockOrderLedgerService.findUnknownPending.mockResolvedValueOnce([
        {
          id: 'lg-unknown-1',
          userId: USER_ID,
          commitHash: COMMIT_HASH,
          idempotencyKey: null,
          status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
          symbol: 'AAPL',
          side: 'buy',
          qty: '10',
          amount: null,
          price: null,
          broker: 'paper',
          brokerOrderId: null,
          brokerRequest: {},
          brokerResponse: null,
          errorReason: 'broker timeout',
          createdAt: updatedAt,
          updatedAt,
          acknowledgedAt: null,
          acknowledgedBy: null,
          acknowledgementNote: null,
        },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/trading/ledger/unknown')
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        id: 'lg-unknown-1',
        status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
        acknowledgedAt: null,
      });
      expect(mockOrderLedgerService.findUnknownPending).toHaveBeenCalledWith(USER_ID, 50);
    });
  });

  describe('POST /api/trading/ledger/:id/acknowledge', () => {
    const LEDGER_ID = 'lg-ack-1';
    const ackedAt = new Date('2026-04-26T02:00:00Z');

    it('returns 200 with the updated row on a valid ack', async () => {
      mockOrderLedgerService.acknowledge.mockResolvedValueOnce({
        id: LEDGER_ID,
        userId: USER_ID,
        commitHash: COMMIT_HASH,
        idempotencyKey: null,
        status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
        symbol: 'AAPL',
        side: 'buy',
        qty: '10',
        amount: null,
        price: null,
        broker: 'paper',
        brokerOrderId: null,
        brokerRequest: {},
        brokerResponse: null,
        errorReason: 'broker timeout',
        createdAt: ackedAt,
        updatedAt: ackedAt,
        acknowledgedAt: ackedAt,
        acknowledgedBy: USER_ID,
        acknowledgementNote: 'verified with broker',
      });

      const res = await request(app.getHttpServer())
        .post(`/api/trading/ledger/${LEDGER_ID}/acknowledge`)
        .send({ note: 'verified with broker' })
        .expect(200);

      expect(res.body).toMatchObject({
        id: LEDGER_ID,
        status: 'UNKNOWN_REQUIRES_OPERATOR_REVIEW',
        acknowledgedAt: ackedAt.toISOString(),
        acknowledgedBy: USER_ID,
        acknowledgementNote: 'verified with broker',
      });
      expect(mockOrderLedgerService.acknowledge).toHaveBeenCalledWith(
        LEDGER_ID,
        USER_ID,
        'verified with broker',
      );
    });

    it('returns 400 for an empty note (Zod min(1) rejection)', async () => {
      await request(app.getHttpServer())
        .post(`/api/trading/ledger/${LEDGER_ID}/acknowledge`)
        .send({ note: '' })
        .expect(400);
      expect(mockOrderLedgerService.acknowledge).not.toHaveBeenCalled();
    });

    it('returns 400 for missing note body', async () => {
      await request(app.getHttpServer())
        .post(`/api/trading/ledger/${LEDGER_ID}/acknowledge`)
        .send({})
        .expect(400);
      expect(mockOrderLedgerService.acknowledge).not.toHaveBeenCalled();
    });

    it('returns 400 for note longer than 1000 chars', async () => {
      await request(app.getHttpServer())
        .post(`/api/trading/ledger/${LEDGER_ID}/acknowledge`)
        .send({ note: 'a'.repeat(1001) })
        .expect(400);
      expect(mockOrderLedgerService.acknowledge).not.toHaveBeenCalled();
    });

    it('propagates 404 from the service when row is missing / wrong user / already acked', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      mockOrderLedgerService.acknowledge.mockRejectedValueOnce(
        new NotFoundException('not found'),
      );
      await request(app.getHttpServer())
        .post(`/api/trading/ledger/${LEDGER_ID}/acknowledge`)
        .send({ note: 'note' })
        .expect(404);
    });
  });
});
