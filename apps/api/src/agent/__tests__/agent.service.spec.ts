import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { AgentService } from '../agent.service';
import { ToolRegistry } from '../tool-registry';
import { UserInvestmentProfileService } from '../user-investment-profile.service';
import { aiConfig } from '../../config/ai.config';
import { personaConfig } from '../../config/persona.config';

const mockStreamAgentTextFromMessages = vi.fn();
const mockCreateOpenRouterModel = vi.fn();

vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenRouterModel: (...args: unknown[]) => mockCreateOpenRouterModel(...args),
  streamAgentTextFromMessages: (...args: unknown[]) => mockStreamAgentTextFromMessages(...args),
}));

describe('AgentService', () => {
  let service: AgentService;
  let mockToolRegistry: {
    buildTools: Mock;
  };
  let mockUserInvestmentProfileService: {
    getProfileSummary: Mock;
  };

  const mockTools = { getStockQuote: { execute: vi.fn() } };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockToolRegistry = {
      buildTools: vi.fn().mockReturnValue(mockTools),
    };
    mockUserInvestmentProfileService = {
      getProfileSummary: vi.fn().mockResolvedValue('Risk tolerance: MODERATE'),
    };

    mockCreateOpenRouterModel.mockReturnValue('mock-model');
    mockStreamAgentTextFromMessages.mockReturnValue(
      (async function* () {
        yield 'Hello ';
        yield 'World';
      })(),
    );

    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: ToolRegistry, useValue: mockToolRegistry },
        {
          provide: UserInvestmentProfileService,
          useValue: mockUserInvestmentProfileService,
        },
        {
          provide: aiConfig.KEY,
          useValue: {
            openrouterApiKey: 'test-key',
            openrouterBaseUrl: 'https://openrouter.example/api/v1',
            model: 'google/gemini-3-flash-preview',
            embeddingModel: 'text-embedding-3-small',
          },
        },
        { provide: personaConfig.KEY, useValue: { active: 'default' } },
      ],
    }).compile();

    service = module.get(AgentService);
  });

  describe('system prompt composition', () => {
    it('composes system prompt with profile + persona', async () => {
      const stream = await service.streamChat(
        'Analyze AAPL risk',
        'user-1',
        [{ role: 'user', content: 'Analyze AAPL risk' }],
        'session-123',
      );

      expect(stream).toBeInstanceOf(ReadableStream);

      expect(mockStreamAgentTextFromMessages).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamAgentTextFromMessages.mock.calls[0]![0];
      expect(callArgs.systemPrompt).toContain('Risk tolerance: MODERATE');
      expect(callArgs.systemPrompt).toContain('[R] Role');
      expect(callArgs.systemPrompt).toContain('[I] Instructions');
    });

    it('composes system prompt without profile (new user)', async () => {
      mockUserInvestmentProfileService.getProfileSummary.mockResolvedValueOnce('');

      const stream = await service.streamChat(
        'Analyze AAPL risk',
        'new-user',
        [{ role: 'user', content: 'Analyze AAPL risk' }],
        'session-456',
      );

      expect(stream).toBeInstanceOf(ReadableStream);

      const callArgs = mockStreamAgentTextFromMessages.mock.calls[0]![0];
      expect(callArgs.systemPrompt).toContain('[R] Role');
      expect(callArgs.systemPrompt).not.toContain('Risk tolerance: MODERATE');
    });
  });

  describe('model configuration', () => {
    it('uses the configured OpenRouter model', async () => {
      await service.streamChat(
        'test',
        'user-1',
        [{ role: 'user', content: 'test' }],
        'session-789',
      );

      expect(mockCreateOpenRouterModel).toHaveBeenCalledWith({
        modelId: 'google/gemini-3-flash-preview',
        baseUrl: 'https://openrouter.example/api/v1',
      });
      expect(mockStreamAgentTextFromMessages.mock.calls[0]![0].model).toBe('mock-model');
    });
  });

  describe('streamAgentTextFromMessages parameters', () => {
    it('calls the runtime with correct parameters', async () => {
      await service.streamChat(
        'Analyze AAPL',
        'user-1',
        [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
          { role: 'user', content: 'Analyze AAPL' },
        ],
        'session-abc',
      );

      expect(mockStreamAgentTextFromMessages).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamAgentTextFromMessages.mock.calls[0]![0];

      expect(callArgs.messages).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Analyze AAPL' },
      ]);
      expect(callArgs.tools).toBe(mockTools);
      expect(callArgs.maxTurns).toBe(10);
    });

    it('passes userId to toolRegistry.buildTools', async () => {
      await service.streamChat(
        'test',
        'user-42',
        [{ role: 'user', content: 'test' }],
        'session-xyz',
      );

      expect(mockToolRegistry.buildTools).toHaveBeenCalledWith('user-42', undefined);
    });

    it('passes portfolioId to toolRegistry.buildTools when provided', async () => {
      await service.streamChat(
        'test',
        'user-42',
        [{ role: 'user', content: 'test' }],
        'session-xyz',
        'portfolio-99',
      );

      expect(mockToolRegistry.buildTools).toHaveBeenCalledWith('user-42', 'portfolio-99');
    });
  });

  describe('SSE output format', () => {
    it('produces SSE events in correct format', async () => {
      const stream = await service.streamChat(
        'Hello',
        'user-1',
        [{ role: 'user', content: 'Hello' }],
        'session-sse',
      );

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];

      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) {
          chunks.push(decoder.decode(result.value, { stream: true }));
        }
      }

      const output = chunks.join('');

      expect(output).toContain('event: message');
      expect(output).toContain('"content"');
      expect(output).toContain('"sessionId":"session-sse"');
      expect(output).toContain('event: done');
      expect(output).toContain('data: [DONE]');
    });

    it('produces error SSE event on stream error', async () => {
      mockStreamAgentTextFromMessages.mockReturnValue(
        (async function* () {
          yield 'start';
          throw new Error('LLM connection failed');
        })(),
      );

      const stream = await service.streamChat(
        'Hello',
        'user-1',
        [{ role: 'user', content: 'Hello' }],
        'session-err',
      );

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];

      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) {
          chunks.push(decoder.decode(result.value, { stream: true }));
        }
      }

      const output = chunks.join('');

      expect(output).toContain('event: error');
      expect(output).toContain('LLM connection failed');
    });
  });
});
