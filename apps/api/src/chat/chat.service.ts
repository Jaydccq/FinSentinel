import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  chatMessages,
  and,
  asc,
  desc,
  eq,
} from '@finsentinel/db';
import type {
  ChatMessageResponse,
  ChatSessionSummary,
  RiskFactor,
  RiskReport,
} from '@finsentinel/shared';
import { AgentService } from '../agent/agent.service';
import { ChatCompactionService } from './chat-compaction.service';
import { PortfolioService } from '../portfolio/portfolio.service';

interface ChatMessageRow {
  id: string;
  userId: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: Date;
}

@Injectable()
export class ChatService {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
    private readonly agentService: AgentService,
    private readonly chatCompactionService: ChatCompactionService,
    private readonly portfolioService: PortfolioService,
  ) {}

  async streamChat(
    message: string,
    userId: string,
    sessionId?: string,
    portfolioId?: string,
  ): Promise<{ sessionId: string; stream: ReadableStream<Uint8Array> }> {
    const resolvedSessionId = sessionId ?? randomUUID();
    const history = await this.getHistoryRows(userId, resolvedSessionId);
    const augmentedMessage = await this.chatCompactionService.augmentPrompt(
      userId,
      resolvedSessionId,
      message,
    );

    await this.persistMessage(userId, resolvedSessionId, 'user', message);

    const sseStream = await this.agentService.streamChat(
      augmentedMessage,
      userId,
      [
        ...history.map((row) => ({
          role: row.role,
          content: row.content,
        })),
        { role: 'user', content: augmentedMessage },
      ],
      resolvedSessionId,
      portfolioId,
    );

    return {
      sessionId: resolvedSessionId,
      stream: this.wrapAssistantPersistence(
        sseStream,
        userId,
        resolvedSessionId,
      ),
    };
  }

  async assess(
    message: string,
    userId: string,
    sessionId?: string,
    portfolioId?: string,
  ): Promise<RiskReport> {
    const resolvedSessionId = sessionId ?? randomUUID();
    await this.persistMessage(userId, resolvedSessionId, 'user', message);

    const report = portfolioId
      ? await this.assessPortfolio(message, userId, portfolioId)
      : this.assessPromptOnly(message);

    await this.persistMessage(
      userId,
      resolvedSessionId,
      'assistant',
      JSON.stringify(report),
    );

    return report;
  }

  async listSessions(userId: string): Promise<ChatSessionSummary[]> {
    const rows = (await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.userId, userId))
      .orderBy(asc(chatMessages.createdAt))) as ChatMessageRow[];

    const summaries = new Map<
      string,
      {
        sessionId: string;
        firstMessage: string;
        messageCount: number;
        createdAt: string;
        lastMessageAt: string;
      }
    >();

    for (const row of rows) {
      const existing = summaries.get(row.sessionId);
      if (!existing) {
        summaries.set(row.sessionId, {
          sessionId: row.sessionId,
          firstMessage: row.content,
          messageCount: 1,
          createdAt: row.createdAt.toISOString(),
          lastMessageAt: row.createdAt.toISOString(),
        });
        continue;
      }

      existing.messageCount += 1;
      existing.lastMessageAt = row.createdAt.toISOString();
    }

    return [...summaries.values()].sort((left, right) =>
      right.lastMessageAt.localeCompare(left.lastMessageAt),
    );
  }

  async getSessionMessages(
    userId: string,
    sessionId: string,
  ): Promise<ChatMessageResponse[]> {
    const rows = await this.getHistoryRows(userId, sessionId);

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async assessPortfolio(
    message: string,
    userId: string,
    portfolioId: string,
  ): Promise<RiskReport> {
    const analytics = await this.portfolioService.getPortfolioAnalytics(
      userId,
      portfolioId,
    );
    const topWeight = Math.max(
      ...analytics.holdingWeights.map((holding) =>
        parseFloat(holding.weightPercent),
      ),
      0,
    );
    const sectorCount = Object.keys(analytics.sectorAllocation).length;
    const concentrationPenalty =
      analytics.hhiIndex >= 2500
        ? 35
        : analytics.hhiIndex >= 1500
          ? 22
          : analytics.hhiIndex >= 1000
            ? 12
            : 4;
    const topHoldingPenalty =
      topWeight >= 40 ? 20 : topWeight >= 25 ? 12 : topWeight >= 15 ? 6 : 0;
    const warningPenalty = Math.min(
      analytics.concentrationWarnings.length * 8,
      20,
    );
    const diversificationPenalty = sectorCount <= 2 ? 10 : 0;
    const riskScore = Math.min(
      100,
      Math.round(
        20 +
          concentrationPenalty +
          topHoldingPenalty +
          warningPenalty +
          diversificationPenalty,
      ),
    );

    const factors: RiskFactor[] = [
      {
        category: 'CONCENTRATION',
        score: Math.min(100, Math.round(analytics.hhiIndex / 35)),
        description: `HHI ${analytics.hhiIndex.toFixed(2)} classified as ${analytics.hhiClassification}.`,
      },
      {
        category: 'POSITION_SIZE',
        score: Math.min(100, Math.round(topWeight * 2)),
        description: `Largest holding is ${topWeight.toFixed(2)}% of portfolio value.`,
      },
      {
        category: 'DIVERSIFICATION',
        score: sectorCount <= 2 ? 70 : 35,
        description: `Portfolio spans ${sectorCount} sector(s).`,
      },
    ];

    const actionableAdvice =
      analytics.concentrationWarnings.length > 0
        ? analytics.concentrationWarnings
        : [
            'Concentration risk is currently manageable, but keep position sizing and sector balance under review.',
          ];

    return {
      riskScore,
      riskLevel: this.toRiskLevel(riskScore),
      summary:
        `Portfolio-aware assessment for request "${message}". ` +
        `Largest position ${topWeight.toFixed(2)}%, ${sectorCount} sector(s), ` +
        `${analytics.concentrationWarnings.length} concentration warning(s).`,
      factors,
      actionableAdvice,
    };
  }

  private assessPromptOnly(message: string): RiskReport {
    const normalized = message.toLowerCase();
    const highRiskSignals =
      Number(/leverag|margin|options|short|all[- ]?in|crypto/.test(normalized));
    const cautionSignals =
      Number(/rebalance|diversif|hedge|drawdown|risk/.test(normalized));
    const riskScore = Math.max(20, Math.min(100, 35 + highRiskSignals * 30 - cautionSignals * 10));

    return {
      riskScore,
      riskLevel: this.toRiskLevel(riskScore),
      summary:
        'General assessment generated from the request text only because no portfolioId was provided.',
      factors: [
        {
          category: 'INPUT_CONTEXT',
          score: 40,
          description: 'Assessment is based on conversation context without direct portfolio holdings.',
        },
        {
          category: 'REQUEST_COMPLEXITY',
          score: highRiskSignals > 0 ? 70 : 35,
          description: highRiskSignals > 0
            ? 'The request mentions leveraged or fast-moving instruments.'
            : 'The request does not explicitly mention leveraged or speculative positioning.',
        },
      ],
      actionableAdvice: [
        'Provide a portfolioId for a holdings-aware risk assessment.',
        'Clarify time horizon, position sizing, and acceptable drawdown before acting.',
      ],
    };
  }

  private toRiskLevel(score: number): string {
    if (score >= 75) return 'HIGH';
    if (score >= 45) return 'MEDIUM';
    return 'LOW';
  }

  private wrapAssistantPersistence(
    source: ReadableStream<Uint8Array>,
    userId: string,
    sessionId: string,
  ): ReadableStream<Uint8Array> {
    const reader = source.getReader();
    const decoder = new TextDecoder();
    let assistantContent = '';
    const persistAssistant = async () => {
      if (assistantContent.length > 0) {
        await this.persistMessage(userId, sessionId, 'assistant', assistantContent);
      }
    };

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              await persistAssistant();
              controller.close();
              return;
            }

            if (!value) {
              continue;
            }

            const chunk = decoder.decode(value, { stream: true });
            if (chunk.includes('event: message')) {
              const match = chunk.match(/data:\s*(\{.+\})/);
              if (match?.[1]) {
                try {
                  const parsed = JSON.parse(match[1]) as { content?: string };
                  assistantContent += parsed.content ?? '';
                } catch {
                  assistantContent += '';
                }
              }
            }

            controller.enqueue(value);
          }
        } catch (error) {
          if (assistantContent.length > 0) {
            await persistAssistant();
          }
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    });
  }

  private async getHistoryRows(
    userId: string,
    sessionId: string,
  ): Promise<ChatMessageRow[]> {
    return (await this.db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.userId, userId),
          eq(chatMessages.sessionId, sessionId),
        ),
      )
      .orderBy(asc(chatMessages.createdAt))) as ChatMessageRow[];
  }

  private async persistMessage(
    userId: string,
    sessionId: string,
    role: string,
    content: string,
  ): Promise<void> {
    await this.db.insert(chatMessages).values({
      userId,
      sessionId,
      role,
      content,
    });
  }
}
