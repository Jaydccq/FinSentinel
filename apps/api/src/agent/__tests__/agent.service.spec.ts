import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { AgentService } from '../agent.service';
import { ToolRegistry } from '../tool-registry';
import { UserInvestmentProfileService } from '../user-investment-profile.service';
import { aiConfig } from '../../config/ai.config';
import { personaConfig } from '../../config/persona.config';

// ── Mock the 'ai' module ────────────────────────────────────────────────────
// We mock streamText to avoid real LLM calls.
const mockStreamText = vi.fn();
vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  tool: vi.fn((def: unknown) => def),
  stepCountIs: vi.fn((n: number) => `stepCountIs(${n})`),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => 'mock-model')),
}));

describe('AgentService', () => {
  let service: AgentService;
  let mockToolRegistry: {
    buildTools: Mock;
    buildStockAnalysisTools: Mock;
  };
  let mockUserInvestmentProfileService: {
    getProfileSummary: Mock;
  };

  const mockTools = { getStockQuote: { execute: vi.fn() } };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockToolRegistry = {
      buildTools: vi.fn().mockReturnValue(mockTools),
      buildStockAnalysisTools: vi.fn().mockReturnValue(mockTools),
    };
    mockUserInvestmentProfileService = {
      getProfileSummary: vi.fn().mockResolvedValue('Risk tolerance: MODERATE'),
    };

    // Default mock: streamText returns a result with a textStream
    mockStreamText.mockReturnValue({
      textStream: (async function* () {
        yield 'Hello ';
        yield 'World';
      })(),
      fullStream: (async function* () {
        yield { type: 'text-delta', textDelta: 'Hello ' };
        yield { type: 'text-delta', textDelta: 'World' };
      })(),
      text: Promise.resolve('Hello World'),
      finishReason: Promise.resolve('stop'),
      usage: Promise.resolve({ promptTokens: 10, completionTokens: 20 }),
    });

    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: ToolRegistry, useValue: mockToolRegistry },
        {
          provide: UserInvestmentProfileService,
          useValue: mockUserInvestmentProfileService,
        },
        { provide: aiConfig.KEY, useValue: { openrouterApiKey: 'test-key', model: 'google/gemini-3-flash-preview' } },
        { provide: personaConfig.KEY, useValue: { active: 'default' } },
      ],
    }).compile();

    service = module.get(AgentService);
  });

  // ── System prompt composition ──────────────────────────────────────────────

  describe('system prompt composition', () => {
    it('composes system prompt with profile + persona', async () => {
      const stream = await service.streamChat(
        'Analyze AAPL risk',
        'user-1',
        [{ role: 'user', content: 'Analyze AAPL risk' }],
        'session-123',
      );

      expect(stream).toBeInstanceOf(ReadableStream);

      // streamText should have been called with system prompt containing persona
      expect(mockStreamText).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamText.mock.calls[0]![0];
      expect(callArgs.system).toBeDefined();
      expect(callArgs.system).toContain('Risk tolerance: MODERATE');
      // Persona prompt should be included (default persona has RISEN sections)
      expect(callArgs.system).toContain('[R] Role');
      expect(callArgs.system).toContain('[I] Instructions');
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

      const callArgs = mockStreamText.mock.calls[0]![0];
      // Even without a profile, the persona prompt should be present
      expect(callArgs.system).toContain('[R] Role');
      expect(callArgs.system).not.toContain('Risk tolerance: MODERATE');
    });
  });

  // ── Model configuration ────────────────────────────────────────────────────

  describe('model configuration', () => {
    it('uses correct model from config', async () => {
      await service.streamChat(
        'test',
        'user-1',
        [{ role: 'user', content: 'test' }],
        'session-789',
      );

      const callArgs = mockStreamText.mock.calls[0]![0];
      // The model should be the result of calling the OpenAI provider function
      expect(callArgs.model).toBeDefined();
    });
  });

  // ── streamText parameters ──────────────────────────────────────────────────

  describe('streamText parameters', () => {
    it('calls streamText with correct parameters', async () => {
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

      expect(mockStreamText).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamText.mock.calls[0]![0];

      // Check messages mapping
      expect(callArgs.messages).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Analyze AAPL' },
      ]);

      // Check tools passed
      expect(callArgs.tools).toBe(mockTools);

      // Check stopWhen is set (replaces maxSteps: 10)
      expect(callArgs.stopWhen).toBeDefined();
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

  // ── SSE output format ──────────────────────────────────────────────────────

  describe('SSE output format', () => {
    it('produces SSE events in correct format', async () => {
      const stream = await service.streamChat(
        'Hello',
        'user-1',
        [{ role: 'user', content: 'Hello' }],
        'session-sse',
      );

      // Read all chunks from the stream
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

      // Must contain message events with JSON data
      expect(output).toContain('event: message');
      expect(output).toContain('"content"');
      expect(output).toContain('"sessionId":"session-sse"');

      // Must end with a done event
      expect(output).toContain('event: done');
      expect(output).toContain('data: [DONE]');
    });

    it('produces error SSE event on stream error', async () => {
      // Override mock to produce an error in the text stream.
      // Use .catch(noop) on rejected promises to avoid unhandled rejection noise.
      const noop = () => {};
      const rejectedText = Promise.reject(new Error('LLM connection failed'));
      const rejectedFinish = Promise.reject(new Error('LLM connection failed'));
      const rejectedUsage = Promise.reject(new Error('LLM connection failed'));
      rejectedText.catch(noop);
      rejectedFinish.catch(noop);
      rejectedUsage.catch(noop);

      mockStreamText.mockReturnValue({
        textStream: (async function* () {
          yield 'start';
          throw new Error('LLM connection failed');
        })(),
        fullStream: (async function* () {
          yield { type: 'text-delta', textDelta: 'start' };
          throw new Error('LLM connection failed');
        })(),
        text: rejectedText,
        finishReason: rejectedFinish,
        usage: rejectedUsage,
      });

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

      // Should contain the error event
      expect(output).toContain('event: error');
      expect(output).toContain('LLM connection failed');
    });
  });
});
