import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { OkxAnalysisService } from '../okx-analysis.service';
import { aiConfig } from '../../config/ai.config';

const mockStreamAgentTextFromMessages = vi.fn();
const mockCreateOpenAICompatibleModel = vi.fn();

vi.mock('@finsentinel/ai-runtime', () => ({
  createOpenAICompatibleModel: (...args: unknown[]) => mockCreateOpenAICompatibleModel(...args),
  streamAgentTextFromMessages: (...args: unknown[]) => mockStreamAgentTextFromMessages(...args),
}));

describe('OkxAnalysisService', () => {
  let service: OkxAnalysisService;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockCreateOpenAICompatibleModel.mockReturnValue('mock-model');
    mockStreamAgentTextFromMessages.mockReturnValue(
      (async function* () {
        yield 'Hello ';
        yield 'World';
      })(),
    );

    const module = await Test.createTestingModule({
      providers: [
        OkxAnalysisService,
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

    service = module.get(OkxAnalysisService);
  });

  it('calls the runtime with market context and emits SSE chunks', async () => {
    service.setClient({
      getTicker: vi.fn().mockResolvedValue({
        last: '100.5',
        bidPx: '100.4',
        askPx: '100.6',
        high24h: '105.0',
        low24h: '98.0',
        vol24h: '1234',
        volCcy24h: '5678',
        open24h: '99.0',
      }),
      getFundingRate: vi.fn().mockResolvedValue({
        fundingRate: '0.0001',
        nextFundingRate: '0.0002',
        fundingTime: '1713379200000',
      }),
    });

    const stream = await service.streamAnalysis('BTC-USDT-SWAP', 'session-okx');

    expect(stream).toBeInstanceOf(ReadableStream);
    expect(mockCreateOpenAICompatibleModel).toHaveBeenCalledWith({
      provider: 'openrouter',
      modelId: 'google/gemini-3-flash-preview',
      baseUrl: 'https://openrouter.example/api/v1',
    });

    expect(mockStreamAgentTextFromMessages).toHaveBeenCalledTimes(1);
    const callArgs = mockStreamAgentTextFromMessages.mock.calls[0]![0];
    expect(callArgs.systemPrompt).toContain('crypto derivatives analyst');
    expect(callArgs.messages).toEqual([
      {
        role: 'user',
        content: expect.stringContaining('Analyze the current state of BTC-USDT-SWAP:'),
      },
    ]);
    expect(callArgs.tools).toEqual({});
    expect(callArgs.maxTurns).toBe(1);
    expect(callArgs.apiKey).toBe('test-key');

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
