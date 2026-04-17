import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { StockAnalysisService } from '../stock-analysis.service';
import { ToolRegistry } from '../tool-registry';
import { aiConfig } from '../../config/ai.config';

const mockStreamAgentTextFromMessages = vi.fn();
const mockCreateOpenRouterModel = vi.fn();

vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenRouterModel: (...args: unknown[]) => mockCreateOpenRouterModel(...args),
  streamAgentTextFromMessages: (...args: unknown[]) => mockStreamAgentTextFromMessages(...args),
}));

describe('StockAnalysisService', () => {
  let service: StockAnalysisService;
  let mockToolRegistry: {
    buildStockAnalysisTools: Mock;
  };

  const mockTools = { getStockQuote: { execute: vi.fn() } };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockToolRegistry = {
      buildStockAnalysisTools: vi.fn().mockReturnValue(mockTools),
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
        StockAnalysisService,
        { provide: ToolRegistry, useValue: mockToolRegistry },
        {
          provide: aiConfig.KEY,
          useValue: {
            openrouterApiKey: 'test-key',
            openrouterBaseUrl: 'https://openrouter.example/api/v1',
            model: 'google/gemini-3-flash-preview',
            embeddingModel: 'text-embedding-3-small',
          },
        },
      ],
    }).compile();

    service = module.get(StockAnalysisService);
  });

  it('calls the runtime with stock-analysis prompt and SSE output', async () => {
    const stream = await service.streamAnalysis(
      'Analyze AAPL',
      [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Analyze AAPL' },
      ],
      'session-stock',
    );

    expect(stream).toBeInstanceOf(ReadableStream);
    expect(mockCreateOpenRouterModel).toHaveBeenCalledWith({
      modelId: 'google/gemini-3-flash-preview',
      baseUrl: 'https://openrouter.example/api/v1',
    });
    expect(mockToolRegistry.buildStockAnalysisTools).toHaveBeenCalledTimes(1);

    expect(mockStreamAgentTextFromMessages).toHaveBeenCalledTimes(1);
    const callArgs = mockStreamAgentTextFromMessages.mock.calls[0]![0];
    expect(callArgs.systemPrompt).toContain('You are a stock analysis assistant');
    expect(callArgs.systemPrompt).toContain('Never fabricate data.');
    expect(callArgs.messages).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Analyze AAPL' },
    ]);
    expect(callArgs.tools).toBe(mockTools);
    expect(callArgs.maxTurns).toBe(10);

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
    expect(output).toContain('"content":"Hello "');
    expect(output).toContain('"content":"World"');
    expect(output).toContain('event: done');
  });
});
