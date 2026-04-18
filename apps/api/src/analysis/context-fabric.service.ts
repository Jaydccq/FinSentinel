import { Injectable, Logger } from '@nestjs/common';
import type { SharedContext, ContextLayer } from '@finsentinel/shared';

export interface LongTermLoader {
  load(userId: string): Promise<string>;
}
export interface MidTermLoader {
  load(userId: string, portfolioId?: string): Promise<string>;
}
export interface SessionLoader {
  load(userId: string, sessionId: string | undefined): Promise<{
    summary: string;
    count: number;
  }>;
}
export interface RetrievalLoader {
  retrieve(
    query: string,
    args: { userId: string; limit?: number },
  ): Promise<Array<{ id: string; snippet: string }>>;
}

export interface JournalContextLoader {
  getRunContext(userId: string, runId: string): Promise<SharedContext>;
}

interface AssembleArgs {
  userId: string;
  sessionId?: string;
  runId?: string;
  prompt: string;
  portfolioId?: string;
}

/**
 * Why adapter interfaces as constructor args: Plan A keeps the concrete wiring
 * (adapter factories to UserInvestmentProfileService / AgentBrainService /
 * ChatCompactionService / RagRetrievalService / ContextJournalService) in
 * AnalysisModule so test doubles stay trivial.
 */
@Injectable()
export class ContextFabricService {
  private readonly logger = new Logger(ContextFabricService.name);

  constructor(
    private readonly longTerm: LongTermLoader,
    private readonly midTerm: MidTermLoader,
    private readonly session: SessionLoader,
    private readonly retrieval: RetrievalLoader,
    private readonly journal?: JournalContextLoader,
  ) {}

  async assemble(args: AssembleArgs): Promise<SharedContext> {
    const adapterContext = await this.buildAdapterContext(args);
    if (args.runId && this.journal) {
      try {
        const journalContext = await this.journal.getRunContext(args.userId, args.runId);
        if (this.hasUsefulContext(journalContext)) {
          return this.mergeContexts(adapterContext, journalContext);
        }
      } catch (err) {
        this.logger.warn(`journal context load failed: ${err}`);
      }
    }

    return adapterContext;
  }

  private async buildAdapterContext(args: AssembleArgs): Promise<SharedContext> {
    const [longSummary, midSummary, sessionSummary, retrieved] = await Promise.all([
      this.safeLoadLong(args.userId),
      this.safeLoadMid(args.userId, args.portfolioId),
      this.safeLoadSession(args.userId, args.sessionId),
      this.safeRetrieve(args.prompt, args.userId),
    ]);
    const now = new Date().toISOString();

    return {
      longTermPreferenceContext: this.layer(longSummary, [], now),
      midTermStrategyContext: this.layer(midSummary, [], now),
      shortTermSessionContext: this.layer(
        `${sessionSummary.summary} (compacted=${sessionSummary.count})`,
        [],
        now,
      ),
      retrievalContext: this.layer(
        retrieved.map((r) => r.snippet).join('\n---\n'),
        retrieved.map((r) => r.id),
        now,
      ),
    };
  }

  toPromptReady(ctx: SharedContext): string {
    return [
      '## Long-term preference',
      ctx.longTermPreferenceContext.summary || '(empty)',
      '',
      '## Mid-term strategy',
      ctx.midTermStrategyContext.summary || '(empty)',
      '',
      '## Short-term session',
      ctx.shortTermSessionContext.summary || '(empty)',
      '',
      '## Retrieved evidence',
      ctx.retrievalContext.summary || '(empty)',
    ].join('\n');
  }

  private layer(summary: string, sourceIds: string[], updatedAt: string): ContextLayer {
    return { summary, sourceIds, updatedAt };
  }

  private mergeContexts(adapter: SharedContext, journal: SharedContext): SharedContext {
    return {
      longTermPreferenceContext: this.mergeLayer(
        adapter.longTermPreferenceContext,
        journal.longTermPreferenceContext,
      ),
      midTermStrategyContext: this.mergeLayer(
        adapter.midTermStrategyContext,
        journal.midTermStrategyContext,
      ),
      shortTermSessionContext: this.mergeLayer(
        adapter.shortTermSessionContext,
        journal.shortTermSessionContext,
      ),
      retrievalContext: this.mergeLayer(adapter.retrievalContext, journal.retrievalContext),
    };
  }

  private mergeLayer(adapter: ContextLayer, journal: ContextLayer): ContextLayer {
    return this.hasUsefulLayer(journal) ? journal : adapter;
  }

  private hasUsefulContext(ctx: SharedContext): boolean {
    return [
      ctx.longTermPreferenceContext,
      ctx.midTermStrategyContext,
      ctx.shortTermSessionContext,
      ctx.retrievalContext,
    ].some((layer) => layer.summary.trim().length > 0 || layer.sourceIds.length > 0);
  }

  private hasUsefulLayer(layer: ContextLayer): boolean {
    return layer.summary.trim().length > 0 || layer.sourceIds.length > 0;
  }

  private async safeLoadLong(userId: string): Promise<string> {
    try {
      return (await this.longTerm.load(userId)) ?? '';
    } catch (err) {
      this.logger.warn(`long-term load failed: ${err}`);
      return '';
    }
  }
  private async safeLoadMid(userId: string, portfolioId?: string): Promise<string> {
    try {
      return (await this.midTerm.load(userId, portfolioId)) ?? '';
    } catch (err) {
      this.logger.warn(`mid-term load failed: ${err}`);
      return '';
    }
  }
  private async safeLoadSession(
    userId: string,
    sessionId: string | undefined,
  ): Promise<{ summary: string; count: number }> {
    if (!sessionId) return { summary: '', count: 0 };
    try {
      return (await this.session.load(userId, sessionId)) ?? { summary: '', count: 0 };
    } catch (err) {
      this.logger.warn(`session load failed: ${err}`);
      return { summary: '', count: 0 };
    }
  }
  private async safeRetrieve(
    prompt: string,
    userId: string,
  ): Promise<Array<{ id: string; snippet: string }>> {
    try {
      return (await this.retrieval.retrieve(prompt, { userId, limit: 8 })) ?? [];
    } catch (err) {
      this.logger.warn(`retrieval failed: ${err}`);
      return [];
    }
  }
}
