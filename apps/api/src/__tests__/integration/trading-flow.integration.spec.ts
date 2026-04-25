/**
 * Trading Flow Integration Test
 *
 * Tests the full stage → commit → execute → check wallet flow
 * through the real NestJS pipeline with mocked infrastructure.
 *
 * The v2 UTA (Unified Trading Architecture) endpoints are tested here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, type createMockDb, type createMockRedis } from './test-app.factory';

describe('Trading Flow (integration)', () => {
  let app: INestApplication;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let authToken: string;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    mockDb = testApp.mockDb;
    mockRedis = testApp.mockRedis;

    // Register a user and get the JWT. The integration suite acts as an
    // SDK-style caller, so it sends X-Client: desktop to receive the token
    // in the response body (browser callers get the token in the cookie only).
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('X-Client', 'desktop')
      .send({
        username: 'trader',
        email: 'trader@example.com',
        password: 'SecurePass1',
      })
      .expect(201);

    authToken = registerRes.body.token;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Auth guard enforcement
  // ═══════════════════════════════════════════════════════════════════════

  it('rejects unauthenticated requests with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/trading/v2/stage')
      .send({ action: 'BUY', symbol: 'AAPL', qty: '10' })
      .expect(401);

    await request(app.getHttpServer()).get('/api/trading/v2/staged').expect(401);

    await request(app.getHttpServer()).get('/api/trading/v2/wallet').expect(401);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // v2 Stage → Commit → Execute → Wallet
  // ═══════════════════════════════════════════════════════════════════════

  it('stage → check staged → commit → execute → check wallet', async () => {
    // ── Step 1: Stage a BUY operation ─────────────────────────────────
    const stageRes = await request(app.getHttpServer())
      .post('/api/trading/v2/stage')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'BUY', symbol: 'AAPL', qty: '10' })
      .expect(201);

    expect(stageRes.body).toHaveProperty('message');
    expect(stageRes.body.message).toContain('Staged');
    expect(stageRes.body.message).toContain('AAPL');
    expect(stageRes.body).toHaveProperty('count', 1);

    // ── Step 2: Check staged operations ──────────────────────────────
    const stagedRes = await request(app.getHttpServer())
      .get('/api/trading/v2/staged')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(stagedRes.body).toHaveProperty('operations');
    expect(stagedRes.body).toHaveProperty('count', 1);
    expect(stagedRes.body.operations).toHaveLength(1);
    expect(stagedRes.body.operations[0]).toHaveProperty('action', 'BUY');
    expect(stagedRes.body.operations[0]).toHaveProperty('symbol', 'AAPL');

    // ── Step 3: Commit the staged operations ─────────────────────────
    const commitRes = await request(app.getHttpServer())
      .post('/api/trading/v2/commit')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'Going long on AAPL' })
      .expect(201);

    expect(commitRes.body).toHaveProperty('hash');
    expect(commitRes.body.hash).toHaveLength(64); // SHA-256 hex
    expect(commitRes.body).toHaveProperty('count', 1);

    // ── Step 4: Staged area should now be empty ──────────────────────
    const emptyStaged = await request(app.getHttpServer())
      .get('/api/trading/v2/staged')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(emptyStaged.body.count).toBe(0);
    expect(emptyStaged.body.operations).toHaveLength(0);

    // ── Step 5: Execute the pending commit ───────────────────────────
    const executeRes = await request(app.getHttpServer())
      .post('/api/trading/v2/execute')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    expect(executeRes.body).toHaveProperty('hash');
    expect(executeRes.body).toHaveProperty('message', 'Going long on AAPL');
    expect(executeRes.body).toHaveProperty('operations');
    expect(executeRes.body.operations).toHaveLength(1);

    // ── Step 6: Check wallet state ───────────────────────────────────
    const walletRes = await request(app.getHttpServer())
      .get('/api/trading/v2/wallet')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(walletRes.body).toHaveProperty('cashBalance');
    expect(walletRes.body).toHaveProperty('initialCapital', '100000.00');
    expect(walletRes.body).toHaveProperty('tradingMode', 'PAPER');
    expect(walletRes.body).toHaveProperty('positions');
    // The wallet should exist (created by getOrCreateWallet)
    expect(walletRes.body).toHaveProperty('totalValue');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error cases
  // ═══════════════════════════════════════════════════════════════════════

  it('commit with empty staging area returns 400', async () => {
    // Clear staging area by reading once (already empty from previous test)
    await request(app.getHttpServer())
      .post('/api/trading/v2/commit')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'Empty commit' })
      .expect(400);
  });

  it('execute without pending commit returns 400', async () => {
    await request(app.getHttpServer())
      .post('/api/trading/v2/execute')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);
  });

  it('stage validates required fields', async () => {
    // Missing action
    await request(app.getHttpServer())
      .post('/api/trading/v2/stage')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ symbol: 'AAPL' })
      .expect(400);

    // Missing symbol
    await request(app.getHttpServer())
      .post('/api/trading/v2/stage')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'BUY' })
      .expect(400);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Compatibility endpoints
  // ═══════════════════════════════════════════════════════════════════════

  it('v1 wallet returns human-readable structure', async () => {
    const walletRes = await request(app.getHttpServer())
      .get('/api/trading/wallet')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(walletRes.body).toHaveProperty('cashBalance');
    expect(walletRes.body).toHaveProperty('initialCapital');
    expect(walletRes.body).toHaveProperty('totalValue');
    expect(walletRes.body).toHaveProperty('returnPercent');
    expect(walletRes.body).toHaveProperty('tradingMode');
  });

  it('v1 history returns history object', async () => {
    const historyRes = await request(app.getHttpServer())
      .get('/api/trading/history')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(historyRes.body).toHaveProperty('history');
  });
});
