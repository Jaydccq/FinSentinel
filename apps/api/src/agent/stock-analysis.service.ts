import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  createOpenAICompatibleModel,
  streamAgentTextFromMessages,
} from '@finsentinel/ai-runtime';
import { ToolRegistry } from './tool-registry';
import { aiConfig } from '../config/ai.config';

const STOCK_ANALYSIS_SYSTEM_PROMPT = `You are a stock analysis assistant. You have access to real-time market data and technical indicators.

When the user asks about a stock:
1. Get the current quote using getStockQuote
2. Get historical price data using getHistoricalPrices
3. Run relevant technical indicators (RSI, MACD, Bollinger Bands, etc.)
4. Synthesize a clear, data-driven analysis

Always cite specific numbers from tool results. Never fabricate data.`;

/**
 * Secondary lightweight agent for stock analysis only.
 * Uses a reduced tool set (market data + technical indicators) and a
 * simpler prompt without persona injection or user profile context.
 *
 * This is the lightweight stock-analysis agent configuration.
 */
@Injectable()
export class StockAnalysisService {
  private readonly logger = new Logger(StockAnalysisService.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    @Inject(aiConfig.KEY) private readonly aiCfg: ConfigType<typeof aiConfig>,
  ) {}

  /**
   * Stream a stock analysis response as SSE events.
   * Uses the same FinSentinel SSE format as the primary agent.
   */
  async streamAnalysis(
    message: string,
    messages: Array<{ role: string; content: string }>,
    sessionId: string,
  ): Promise<ReadableStream<Uint8Array>> {
    const tools = this.toolRegistry.buildStockAnalysisTools();

    const textStream = streamAgentTextFromMessages({
      model: this.getModel(),
      apiKey: this.aiCfg.apiKey ?? this.aiCfg.openrouterApiKey,
      systemPrompt: STOCK_ANALYSIS_SYSTEM_PROMPT,
      messages: messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      tools,
      maxTurns: 10,
    });

    return this.toFinSentinelSSE(textStream, sessionId);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private getModel() {
    return createOpenAICompatibleModel({
      provider: this.aiCfg.provider ?? 'openrouter',
      modelId: this.aiCfg.model,
      baseUrl: this.aiCfg.baseUrl ?? this.aiCfg.openrouterBaseUrl,
    });
  }

  private toFinSentinelSSE(
    textStream: AsyncIterable<string>,
    sessionId: string,
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const logger = this.logger;

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of textStream) {
            const data = JSON.stringify({ content: chunk, sessionId });
            controller.enqueue(
              encoder.encode(`event: message\ndata: ${data}\n\n`),
            );
          }
          controller.enqueue(
            encoder.encode('event: done\ndata: [DONE]\n\n'),
          );
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : 'Unknown streaming error';
          logger.error('SSE stream error', err);
          const data = JSON.stringify({ error: errorMessage });
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${data}\n\n`),
          );
        } finally {
          controller.close();
        }
      },
    });
  }
}
