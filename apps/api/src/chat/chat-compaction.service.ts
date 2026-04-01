import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chatMessages, chatSessionMemories, eq, and, asc } from '@finsentinel/db';
import { sql } from 'drizzle-orm';

/**
 * Chat context compaction service.
 *
 * When a chat session exceeds the configured message threshold,
 * the oldest messages are summarized via LLM and stored in
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

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
    configService: ConfigService,
  ) {
    this.enabled = configService.get<boolean>('chat.compaction.enabled', true);
    this.threshold = configService.get<number>('chat.compaction.threshold', 24);
    this.recentWindow = configService.get<number>('chat.compaction.recentWindow', 10);
    this.maxSummaryChars = configService.get<number>('chat.compaction.maxSummaryChars', 1200);
  }

  /**
   * Augment the user message with a context summary if the session
   * has enough messages to warrant compaction.
   *
   * @returns The original message (if below threshold or disabled),
   *          or `[Previous context summary: ...]\n\n{userMessage}`.
   */
  async augmentPrompt(
    userId: string,
    sessionId: string,
    userMessage: string,
  ): Promise<string> {
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
      .where(
        and(
          eq(chatMessages.userId, userId),
          eq(chatMessages.sessionId, sessionId),
        ),
      );

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
      .where(
        and(
          eq(chatMessages.userId, userId),
          eq(chatMessages.sessionId, sessionId),
        ),
      )
      .orderBy(asc(chatMessages.createdAt))
      .limit(limit);
  }

  /**
   * Generate a summary of old messages using LLM.
   *
   * TODO: Wire actual AI SDK generateText call here.
   * For now, returns a concatenated summary of the conversation.
   */
  async generateSummary(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    // Build a compact conversation representation
    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    // Truncate to maxSummaryChars
    if (conversationText.length <= this.maxSummaryChars) {
      return conversationText;
    }

    return conversationText.substring(0, this.maxSummaryChars);
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
