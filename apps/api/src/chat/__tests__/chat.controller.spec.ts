import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ChatController } from '../chat.controller';
import { ChatService } from '../chat.service';
import { chatRequestSchema } from '@finsentinel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const mockChatService = {
  streamChat: vi.fn(),
  assess: vi.fn(),
  listSessions: vi.fn(),
  getSessionMessages: vi.fn(),
};

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

function createMockResponse() {
  const headers = new Map<string, string>();
  const writes: string[] = [];

  return {
    statusCode: 0,
    ended: false,
    headers,
    writes,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    write(value: Uint8Array) {
      writes.push(new TextDecoder().decode(value));
    },
    end() {
      this.ended = true;
    },
  };
}

describe('ChatController', () => {
  let controller: ChatController;
  const user = { userId: USER_ID, username: 'testuser' };
  const validationPipe = new ZodValidationPipe(chatRequestSchema);

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ChatController(mockChatService as unknown as ChatService);
  });

  describe('stream', () => {
    it('sets SSE headers and writes stream chunks', async () => {
      const sseChunks = [
        `event: message\ndata: {"content":"Hello","sessionId":"${SESSION_ID}"}\n\n`,
        'event: done\ndata: [DONE]\n\n',
      ];
      mockChatService.streamChat.mockResolvedValueOnce({
        sessionId: SESSION_ID,
        stream: createSSEStream(sseChunks),
      });
      const res = createMockResponse();

      await controller.stream(
        { message: 'Analyze AAPL', sessionId: SESSION_ID },
        user,
        res as never,
      );

      expect(res.statusCode).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(res.writes.join('')).toContain('event: message');
      expect(res.writes.join('')).toContain('"content":"Hello"');
      expect(res.ended).toBe(true);
      expect(mockChatService.streamChat).toHaveBeenCalledWith(
        'Analyze AAPL',
        USER_ID,
        SESSION_ID,
        undefined,
      );
    });

    it('passes undefined sessionId when omitted', async () => {
      mockChatService.streamChat.mockResolvedValueOnce({
        sessionId: SESSION_ID,
        stream: createSSEStream(['event: done\ndata: [DONE]\n\n']),
      });

      await controller.stream(
        { message: 'Hello agent' },
        user,
        createMockResponse() as never,
      );

      expect(mockChatService.streamChat).toHaveBeenCalledWith(
        'Hello agent',
        USER_ID,
        undefined,
        undefined,
      );
    });
  });

  describe('assess', () => {
    it('delegates to chat service', async () => {
      mockChatService.assess.mockResolvedValueOnce({
        riskScore: 25,
        riskLevel: 'LOW',
        summary: 'General assessment generated from request text.',
        factors: [],
        actionableAdvice: ['Provide a portfolioId for a holdings-aware assessment.'],
      });

      const result = await controller.assess(
        { message: 'Assess AAPL risk' },
        user,
      );

      expect(result.riskScore).toBe(25);
      expect(mockChatService.assess).toHaveBeenCalledWith(
        'Assess AAPL risk',
        USER_ID,
        undefined,
        undefined,
      );
    });
  });

  describe('sessions', () => {
    it('returns chat sessions from chat service', async () => {
      mockChatService.listSessions.mockResolvedValueOnce([
        {
          sessionId: SESSION_ID,
          firstMessage: 'Assess AAPL risk',
          messageCount: 2,
          createdAt: '2026-04-02T12:00:00.000Z',
          lastMessageAt: '2026-04-02T12:01:00.000Z',
        },
      ]);

      const result = await controller.listSessions(user);

      expect(result).toHaveLength(1);
      expect(result[0]!.sessionId).toBe(SESSION_ID);
    });

    it('returns session messages from chat service', async () => {
      mockChatService.getSessionMessages.mockResolvedValueOnce([
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          sessionId: SESSION_ID,
          role: 'user',
          content: 'Assess AAPL risk',
          createdAt: '2026-04-02T12:00:00.000Z',
        },
      ]);

      const result = await controller.getSessionMessages(user, SESSION_ID);

      expect(result).toHaveLength(1);
      expect(result[0]!.sessionId).toBe(SESSION_ID);
    });
  });

  describe('validation', () => {
    it('rejects empty message', async () => {
      expect(() =>
        validationPipe.transform(
          { message: '' },
        ),
      ).toThrow(BadRequestException);
    });

    it('rejects missing message', async () => {
      expect(() =>
        validationPipe.transform(
          {},
        ),
      ).toThrow(BadRequestException);
    });

    it('rejects invalid sessionId', async () => {
      expect(() =>
        validationPipe.transform(
          { message: 'Hello', sessionId: 'not-a-uuid' },
        ),
      ).toThrow(BadRequestException);
    });

    it('accepts valid payload', async () => {
      const result = validationPipe.transform(
        { message: 'Hello', sessionId: SESSION_ID },
      );

      expect(result).toEqual({ message: 'Hello', sessionId: SESSION_ID });
    });
  });
});
