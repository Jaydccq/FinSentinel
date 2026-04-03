/**
 * Chat Streaming Integration Test
 *
 * Tests the SSE streaming endpoint and its response format.
 *
 * Since the AI model is not mocked at the streamText level (that would
 * require replacing the entire AgentService), we test:
 * 1. Auth enforcement on chat endpoints
 * 2. SSE headers are set correctly
 * 3. Response content-type is text/event-stream
 * 4. Non-streaming endpoints return persisted chat data / risk report shapes
 *
 * The actual AI streaming is tested via the AgentService unit tests.
 * Here we focus on the controller → service wiring and HTTP contract.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, type createMockRedis } from './test-app.factory';

describe('Chat Stream (integration)', () => {
  let app: INestApplication;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let authToken: string;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    mockRedis = testApp.mockRedis;

    // Register a user to get a JWT
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        username: 'chatuser',
        email: 'chat@example.com',
        password: 'SecurePass1',
      })
      .expect(201);

    authToken = registerRes.body.token;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Auth enforcement
  // ═══════════════════════════════════════════════════════════════════════

  it('rejects unauthenticated chat requests with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/chat/stream')
      .send({ message: 'Hello' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/chat/assess')
      .send({ message: 'Analyze AAPL' })
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/chat/sessions')
      .expect(401);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Non-streaming endpoints
  // ═══════════════════════════════════════════════════════════════════════

  it('GET /chat/sessions returns empty array for new user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/chat/sessions')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('GET /chat/sessions/:sessionId returns empty array for an unknown session', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/chat/sessions/11111111-1111-1111-1111-111111111111')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('POST /chat/assess returns a generated risk report', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/chat/assess')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'Analyze AAPL risk' })
      .expect(200);

    expect(res.body).toHaveProperty('riskScore');
    expect(typeof res.body.riskScore).toBe('number');
    expect(res.body.riskScore).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('riskLevel');
    expect(res.body).toHaveProperty('summary');
    expect(res.body).toHaveProperty('factors');
    expect(res.body).toHaveProperty('actionableAdvice');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Validation
  // ═══════════════════════════════════════════════════════════════════════

  it('POST /chat/stream validates request body', async () => {
    // Empty body should fail validation (message is required)
    await request(app.getHttpServer())
      .post('/api/chat/stream')
      .set('Authorization', `Bearer ${authToken}`)
      .send({})
      .expect(400);
  });

  it('POST /chat/assess validates request body', async () => {
    await request(app.getHttpServer())
      .post('/api/chat/assess')
      .set('Authorization', `Bearer ${authToken}`)
      .send({})
      .expect(400);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SSE stream endpoint — basic connectivity test
  // ═══════════════════════════════════════════════════════════════════════

  it('POST /chat/stream returns text/event-stream content type', async () => {
    // The AgentService.streamChat will attempt to call the LLM (mocked AI config).
    // Since there is no real AI backend, the stream will likely produce an error event.
    // What matters is that the SSE response format is correct.
    const res = await request(app.getHttpServer())
      .post('/api/chat/stream')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'Analyze AAPL' })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          callback(null, data);
        });
      });

    // The response should have SSE content type
    expect(res.headers['content-type']).toContain('text/event-stream');

    // The response body should contain SSE events
    const body = res.body as string;
    // It should end with either a done event or an error event (both are valid SSE)
    const hasValidEnding =
      body.includes('event: done') || body.includes('event: error');
    expect(hasValidEnding).toBe(true);
  });
});
