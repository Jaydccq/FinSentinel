import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { createOpenAICompatibleModel, generateAgentText } from '@finsentinel/ai-runtime';
import { chatMessages, chatSessionMemories, eq, and, asc } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';
import { sql } from 'drizzle-orm';
import { ContextJournalService } from '../analysis/context-journal.service';
import { aiConfig } from '../config/ai.config';

/**
 * Chat context compaction service.
 *
 * When a chat session exceeds the configured message threshold,
 * the oldest messages are summarized via the configured LLM and stored in
 * `chatSessionMemories`. The summary is prepended to the user's
 * next message to maintain context without sending all history.
 *
 * Config (from chat.config.ts):
 * - CHAT_COMPACTION_ENABLED (default true)
 * - CHAT_COMPACTION_THRESHOLD (default 24)
 * - CHAT_COMPACTION_RECENT_WINDOW (default 10)
 * - CHAT_COMPACTION_MAX_SUMMARY_CHARS (default 1200)
 */
@Injectable()
export class ChatCompactionService {
  private readonly logger = new Logger(ChatCompactionService.name);
  private readonly enabled: boolean;
  private readonly threshold: number;
  private readonly recentWindow: number;
  private readonly maxSummaryChars: number;
  private readonly model;

  constructor(
    @Inject('DRIZZLE_DB') private readonly db: DrizzleDB,
    configService: ConfigService,
    @Inject(aiConfig.KEY) private readonly aiCfg: ConfigType<typeof aiConfig>,
    @Optional() private readonly contextJournal?: ContextJournalService,
  ) {
    this.enabled = configService.get<boolean>('chat.compaction.enabled', true);
    this.threshold = configService.get<number>('chat.compaction.threshold', 24);
    this.recentWindow = configService.get<number>('chat.compaction.recentWindow', 10);
    this.maxSummaryChars = configService.get<number>('chat.compaction.maxSummaryChars', 1200);

    this.model = createOpenAICompatibleModel({
      provider: this.aiCfg.provider ?? 'openrouter',
      modelId: this.aiCfg.model,
      baseUrl: this.aiCfg.baseUrl ?? this.aiCfg.openrouterBaseUrl,
    });
  }

  /**
   * Augment the user message with a context summary if the session
   * has enough messages to warrant compaction.
   *
   * @returns The original message (if below threshold or disabled),
   *          or `[Previous context summary: ...]\n\n{userMessage}`.
   */
  async augmentPrompt(userId: string, sessionId: string, userMessage: string): Promise<string> {
    if (!this.enabled) {
      return userMessage;
    }

    // 1. Count messages in session
    const messageCount = await this.countSessionMessages(userId, sessionId);

    if (messageCount < this.threshold) {
      return userMessage;
    }

    // 2. Fetch oldest (count - recentWindow) messages for summarization
    const compactCount = messageCount - this.recentWindow;
    if (compactCount <= 0) {
      return userMessage;
    }

    const oldMessages = await this.getOldestMessages(userId, sessionId, compactCount);
    if (oldMessages.length === 0) {
      return userMessage;
    }

    // 3. Generate summary via LLM
    const summary = await this.generateSummary(oldMessages);

    // 4. Store summary in chatSessionMemories
    await this.storeSummary(userId, sessionId, summary, oldMessages.length);

    try {
      await this.contextJournal?.append({
        userId,
        sessionId,
        entryType: 'COMPACTION_BOUNDARY',
        sourceType: 'CHAT',
        sourceRef: `chat_messages/${sessionId}`,
        payload: {
          threshold: this.threshold,
          recentWindow: this.recentWindow,
          compactedCount: oldMessages.length,
        },
      });
    } catch (error) {
      this.logger.warn(`context journal compaction boundary append failed: ${error}`);
    }

    try {
      await this.contextJournal?.appendCompactionSummary({
        userId,
        sessionId,
        payload: {
          summaryText: summary,
          compactedMessageCount: oldMessages.length,
        },
      });
    } catch (error) {
      this.logger.warn(`context journal compaction summary append failed: ${error}`);
    }

    this.logger.log(
      `Compacted ${oldMessages.length} messages into summary (${summary.length} chars) ` +
        `for session ${sessionId}`,
    );

    // 5. Prepend summary to user message
    return `[Previous context summary: ${summary}]\n\n${userMessage}`;
  }

  /** Count total messages in a session for this user. */
  private async countSessionMessages(userId: string, sessionId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .where(and(eq(chatMessages.userId, userId), eq(chatMessages.sessionId, sessionId)));

    return Number(row?.count ?? 0);
  }

  /** Fetch the oldest N messages from a session, ordered by createdAt ascending. */
  private async getOldestMessages(
    userId: string,
    sessionId: string,
    limit: number,
  ): Promise<Array<{ role: string; content: string }>> {
    return this.db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(and(eq(chatMessages.userId, userId), eq(chatMessages.sessionId, sessionId)))
      .orderBy(asc(chatMessages.createdAt))
      .limit(limit);
  }

  /**
   * Generate a summary of old messages using the configured LLM.
   *
   * Falls back to truncation if the LLM call fails.
   */
  async generateSummary(messages: Array<{ role: string; content: string }>): Promise<string> {
    const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

    try {
      const text = await generateAgentText({
        model: this.model,
        apiKey: this.aiCfg.apiKey ?? this.aiCfg.openrouterApiKey,
        systemPrompt:
          `You are a financial assistant summarizer. Produce a concise summary ` +
          `of the conversation below, capturing key topics, tickers, decisions, ` +
          `and any action items. Keep it under ${this.maxSummaryChars} characters. ` +
          `Return only the summary text, no extra commentary.`,
        prompt: conversationText,
        tools: {},
      });

      return text.substring(0, this.maxSummaryChars);
    } catch (error) {
      this.logger.warn(`LLM summary failed, using heuristic fallback: ${error}`);
      // Heuristic fallback: truncate
      return conversationText.substring(0, this.maxSummaryChars);
    }
  }

  /** Upsert a compaction summary into chatSessionMemories. */
  private async storeSummary(
    userId: string,
    sessionId: string,
    summary: string,
    compactedCount: number,
  ): Promise<void> {
    // Use an upsert: insert or update if the user+session combo already exists
    await this.db
      .insert(chatSessionMemories)
      .values({
        userId,
        sessionId,
        summaryText: summary,
        compactedMessageCount: compactedCount,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [chatSessionMemories.userId, chatSessionMemories.sessionId],
        set: {
          summaryText: summary,
          compactedMessageCount: compactedCount,
          updatedAt: new Date(),
        },
      });
  }

  /** Returns whether compaction is enabled. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Returns the configured threshold. */
  getThreshold(): number {
    return this.threshold;
  }
}
