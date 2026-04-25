import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createOpenAICompatibleModel, streamAgentTextFromMessages } from '@finsentinel/ai-runtime';
import { aiConfig } from '../config/ai.config';
import type { OkxApiClient } from './okx-api.client';

/**
 * AI-powered analysis for OKX crypto derivatives.
 *
 * Uses the shared AI runtime to generate streaming analysis of
 * perpetual swap instruments, including funding rate context.
 *
 * Produces SSE events in the FinSentinel format (same pattern as AgentService).
 */
@Injectable()
export class OkxAnalysisService {
  private readonly logger = new Logger(OkxAnalysisService.name);
  private readonly model;
  private client: OkxApiClient | null = null;

  constructor(@Inject(aiConfig.KEY) private readonly aiCfg: ConfigType<typeof aiConfig>) {
    this.model = createOpenAICompatibleModel({
      provider: this.aiCfg.provider ?? 'openrouter',
      modelId: this.aiCfg.model,
      baseUrl: this.aiCfg.baseUrl ?? this.aiCfg.openrouterBaseUrl,
    });
  }

  /**
   * Set the OKX API client for fetching live data.
   * Called by OkxModule during initialization.
   */
  setClient(client: OkxApiClient): void {
    this.client = client;
  }

  /**
   * Stream AI analysis for a crypto derivatives instrument.
   *
   * Fetches real-time ticker and funding rate data, then sends to the LLM
   * for analysis. Returns a ReadableStream of SSE events.
   */
  async streamAnalysis(instId: string, sessionId: string): Promise<ReadableStream<Uint8Array>> {
    // 1. Gather market context
    let marketContext = '';
    if (this.client) {
      const [ticker, fundingRate] = await Promise.all([
        this.client.getTicker(instId),
        this.client.getFundingRate(instId),
      ]);

      if (ticker) {
        marketContext += `\nTicker Data for ${instId}:\n`;
        marketContext += `- Last Price: ${ticker.last}\n`;
        marketContext += `- Bid: ${ticker.bidPx} / Ask: ${ticker.askPx}\n`;
        marketContext += `- 24h High: ${ticker.high24h} / Low: ${ticker.low24h}\n`;
        marketContext += `- 24h Volume: ${ticker.vol24h} contracts (${ticker.volCcy24h} currency)\n`;
        marketContext += `- 24h Open: ${ticker.open24h}\n`;
      }

      if (fundingRate) {
        marketContext += `\nFunding Rate:\n`;
        marketContext += `- Current: ${fundingRate.fundingRate}\n`;
        marketContext += `- Next Predicted: ${fundingRate.nextFundingRate}\n`;
        marketContext += `- Next Settlement: ${new Date(Number(fundingRate.fundingTime)).toISOString()}\n`;
      }
    }

    // 2. Stream LLM analysis
    const systemPrompt = [
      'You are a crypto derivatives analyst specializing in perpetual swaps and futures.',
      'Provide concise, actionable analysis based on the market data provided.',
      'Focus on: price action, funding rate implications, volume analysis, and risk factors.',
      'Format your response with clear sections and bullet points.',
    ].join('\n');

    const userMessage = marketContext
      ? `Analyze the current state of ${instId}:\n${marketContext}`
      : `Provide a general analysis framework for ${instId}. No live data is currently available.`;

    const textStream = streamAgentTextFromMessages({
      model: this.model,
      apiKey: this.aiCfg.apiKey ?? this.aiCfg.openrouterApiKey,
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      tools: {},
      maxTurns: 1,
    });

    // 3. Transform to FinSentinel SSE format
    return this.toFinSentinelSSE(textStream, sessionId);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

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
            controller.enqueue(encoder.encode(`event: message\ndata: ${data}\n\n`));
          }
          controller.enqueue(encoder.encode('event: done\ndata: [DONE]\n\n'));
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown streaming error';
          logger.error('SSE stream error in OKX analysis', err);
          const data = JSON.stringify({ error: errorMessage });
          controller.enqueue(encoder.encode(`event: error\ndata: ${data}\n\n`));
        } finally {
          controller.close();
        }
      },
    });
  }
}
