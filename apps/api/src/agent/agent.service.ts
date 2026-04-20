import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  createOpenAICompatibleModel,
  streamAgentTextFromMessages,
} from '@finsentinel/ai-runtime';
import { ToolRegistry } from './tool-registry';
import { getPersonaPrompt } from './personas';
import { aiConfig } from '../config/ai.config';
import { personaConfig } from '../config/persona.config';
import { UserInvestmentProfileService } from './user-investment-profile.service';

/**
 * Primary AI agent service. Orchestrates LLM calls with tools, persona
 * injection, and streaming. Produces SSE events in the FinSentinel format
 * so the existing frontend works without changes.
 *
 * This is the primary orchestration service for the FinSentinel agent runtime.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly model;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly userInvestmentProfileService: UserInvestmentProfileService,
    @Inject(aiConfig.KEY) private readonly aiCfg: ConfigType<typeof aiConfig>,
    @Inject(personaConfig.KEY) private readonly persona: ConfigType<typeof personaConfig>,
  ) {
    this.model = createOpenAICompatibleModel({
      provider: this.aiCfg.provider ?? 'openrouter',
      modelId: this.aiCfg.model,
      baseUrl: this.aiCfg.baseUrl ?? this.aiCfg.openrouterBaseUrl,
    });
  }

  /**
   * Stream a chat response as SSE events in the FinSentinel format:
   *   event: message\ndata: {"content":"chunk","sessionId":"uuid"}\n\n
   *   event: done\ndata: [DONE]\n\n
   *   event: error\ndata: {"error":"message"}\n\n
   */
  async streamChat(
    message: string,
    userId: string,
    messages: Array<{ role: string; content: string }>,
    sessionId: string,
    portfolioId?: string,
  ): Promise<ReadableStream<Uint8Array>> {
    // 1. Load user profile (stub — actual UserInvestmentProfileService built in Phase 6)
    const profileSummary = await this.loadProfileSummary(userId);

    // 2. Compose system prompt: profile + persona
    const personaPrompt = getPersonaPrompt(this.persona.active);
    const systemPrompt = profileSummary
      ? `${profileSummary}\n\n${personaPrompt}`
      : personaPrompt;

    // 3. Build tools for this request
    const tools = this.toolRegistry.buildTools(userId, portfolioId);

    // 4. Stream from LLM
    const textStream = streamAgentTextFromMessages({
      model: this.model,
      apiKey: this.aiCfg.apiKey ?? this.aiCfg.openrouterApiKey,
      systemPrompt,
      messages: messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      tools,
      maxTurns: 10,
    });

    // 5. Transform into FinSentinel SSE format
    return this.toFinSentinelSSE(textStream, sessionId);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Stub profile loader. Returns null for now.
   * Will be replaced by UserInvestmentProfileService in Phase 6.
   */
  private async loadProfileSummary(userId: string): Promise<string | null> {
    try {
      return await this.userInvestmentProfileService.getProfileSummary(userId);
    } catch (error) {
      this.logger.warn(
        `Failed to load investment profile for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Transform the AI SDK textStream into FinSentinel SSE format:
   *   event: message\ndata: {"content":"...","sessionId":"..."}\n\n
   *   event: done\ndata: [DONE]\n\n
   *   event: error\ndata: {"error":"..."}\n\n
   */
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
