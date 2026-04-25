import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatController } from '../chat.controller';
import { ChatService } from '../chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: { streamChat: ReturnType<typeof vi.fn>; assess: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    chatService = {
      streamChat: vi.fn().mockResolvedValue({
        sessionId: 'sess-1',
        stream: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      }),
      assess: vi.fn().mockResolvedValue({
        riskScore: 45,
        riskLevel: 'MEDIUM',
        summary: 'test',
        factors: [],
        actionableAdvice: [],
      }),
    };
    controller = new ChatController(chatService as unknown as ChatService);
  });

  it('passes portfolioId from body to streamChat', async () => {
    const mockRes = {
      status: vi.fn(),
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    } as any;

    await controller.stream(
      { message: 'test', portfolioId: 'p-123' },
      { userId: 'u-1', username: 'tester' },
      mockRes,
    );

    expect(chatService.streamChat).toHaveBeenCalledWith('test', 'u-1', undefined, 'p-123');
  });

  it('passes portfolioId from body to assess', async () => {
    await controller.assess(
      { message: 'test', portfolioId: 'p-456' },
      { userId: 'u-1', username: 'tester' },
    );

    expect(chatService.assess).toHaveBeenCalledWith('test', 'u-1', undefined, 'p-456');
  });

  it('works without portfolioId (undefined)', async () => {
    await controller.assess({ message: 'test' }, { userId: 'u-1', username: 'tester' });

    expect(chatService.assess).toHaveBeenCalledWith('test', 'u-1', undefined, undefined);
  });
});
