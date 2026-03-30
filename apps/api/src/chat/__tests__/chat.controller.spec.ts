import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ChatController } from '../chat.controller';
import { AgentService } from '../../agent/agent.service';
import { JwtGuard } from '../../auth/jwt.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';

// ── Constants ──────────────────────────────────────────────────────────────
const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ── Mock AgentService ─────────────────────────────────────────────────────
const mockAgentService = {
  streamChat: vi.fn(),
};

// ── Fake JwtGuard that injects userId ─────────────────────────────────────
const fakeJwtGuard = {
  canActivate: (context: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
    const req = context.switchToHttp().getRequest();
    req['user'] = { userId: USER_ID, username: 'testuser' };
    return true;
  },
};

// ── Fake RateLimitGuard (always passes) ───────────────────────────────────
const fakeRateLimitGuard = {
  canActivate: () => true,
};

/**
 * Helper to create a ReadableStream from SSE chunks.
 */
function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('ChatController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: AgentService, useValue: mockAgentService },
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue(fakeJwtGuard)
      .overrideGuard(RateLimitGuard)
      .useValue(fakeRateLimitGuard)
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── POST /api/chat/stream ──────────────────────────────────────────────

  describe('POST /api/chat/stream', () => {
    it('returns SSE headers and streams data', async () => {
      const sseChunks = [
        `event: message\ndata: {"content":"Hello","sessionId":"${SESSION_ID}"}\n\n`,
        `event: done\ndata: [DONE]\n\n`,
      ];
      mockAgentService.streamChat.mockResolvedValueOnce(createSSEStream(sseChunks));

      const res = await request(app.getHttpServer())
        .post('/api/chat/stream')
        .send({ message: 'Analyze AAPL', sessionId: SESSION_ID })
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.text).toContain('event: message');
      expect(res.text).toContain('"content":"Hello"');
      expect(res.text).toContain('event: done');
    });

    it('calls agentService.streamChat with correct arguments', async () => {
      mockAgentService.streamChat.mockResolvedValueOnce(
        createSSEStream(['event: done\ndata: [DONE]\n\n']),
      );

      await request(app.getHttpServer())
        .post('/api/chat/stream')
        .send({ message: 'Test message', sessionId: SESSION_ID })
        .expect(200);

      expect(mockAgentService.streamChat).toHaveBeenCalledWith(
        'Test message',
        USER_ID,
        [{ role: 'user', content: 'Test message' }],
        SESSION_ID,
      );
    });

    it('generates sessionId when not provided', async () => {
      mockAgentService.streamChat.mockResolvedValueOnce(
        createSSEStream(['event: done\ndata: [DONE]\n\n']),
      );

      await request(app.getHttpServer())
        .post('/api/chat/stream')
        .send({ message: 'Hello agent' })
        .expect(200);

      // Should have been called with a generated UUID as the 4th argument
      expect(mockAgentService.streamChat).toHaveBeenCalledTimes(1);
      const [, , , sessionIdArg] = mockAgentService.streamChat.mock.calls[0]!;
      expect(sessionIdArg).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('returns 400 for empty message', async () => {
      await request(app.getHttpServer())
        .post('/api/chat/stream')
        .send({ message: '' })
        .expect(400);
    });

    it('returns 400 for missing message', async () => {
      await request(app.getHttpServer())
        .post('/api/chat/stream')
        .send({})
        .expect(400);
    });

    it('returns 400 for invalid sessionId', async () => {
      await request(app.getHttpServer())
        .post('/api/chat/stream')
        .send({ message: 'Hello', sessionId: 'not-a-uuid' })
        .expect(400);
    });
  });

  // ── POST /api/chat/assess ─────────────────────────────────────────────

  describe('POST /api/chat/assess', () => {
    it('returns stub RiskReport', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/chat/assess')
        .send({ message: 'Assess AAPL risk' })
        .expect(200);

      expect(res.body).toEqual({
        riskScore: 0,
        riskLevel: 'UNKNOWN',
        summary: 'Risk assessment not yet implemented.',
        factors: [],
        actionableAdvice: [],
      });
    });

    it('returns 400 for invalid body', async () => {
      await request(app.getHttpServer())
        .post('/api/chat/assess')
        .send({})
        .expect(400);
    });
  });

  // ── GET /api/chat/sessions ────────────────────────────────────────────

  describe('GET /api/chat/sessions', () => {
    it('returns empty array (stub)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/chat/sessions')
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  // ── GET /api/chat/sessions/:sessionId ─────────────────────────────────

  describe('GET /api/chat/sessions/:sessionId', () => {
    it('returns empty array (stub)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/chat/sessions/${SESSION_ID}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });
});
