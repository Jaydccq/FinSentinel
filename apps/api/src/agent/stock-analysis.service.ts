import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { streamText, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
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

    const result = streamText({
      model: this.getModel(),
      system: STOCK_ANALYSIS_SYSTEM_PROMPT,
      messages: messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      tools,
      stopWhen: stepCountIs(10),
      onError: ({ error }) => {
        this.logger.error('Stock analysis streamText error', error);
      },
    });

    return this.toFinSentinelSSE(result.textStream, sessionId);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private getModel() {
    const openrouter = createOpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: this.aiCfg.openrouterApiKey,
    });
    return openrouter(this.aiCfg.model);
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
