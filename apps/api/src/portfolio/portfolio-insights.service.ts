import { Injectable } from '@nestjs/common';
import type { PortfolioInsight, RelevantEvent } from '@finsentinel/shared';
import { PortfolioService } from './portfolio.service';
import { NewsAnalysisService } from '../agent/news-analysis.service';

const MAX_EVENT_HOLDINGS = 3;
const NEWS_LOOKBACK_DAYS = 7;

@Injectable()
export class PortfolioInsightsService {
  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly newsAnalysisService: NewsAnalysisService,
  ) {}

  async getInsight(userId: string, portfolioId: string): Promise<PortfolioInsight> {
    const analytics = await this.portfolioService.getPortfolioAnalytics(userId, portfolioId);
    const holdingCount = analytics.holdingWeights.length;

    // ── Empty state ─────────────────────────────────────────────────
    if (holdingCount === 0) {
      return {
        portfolioId,
        generatedAt: new Date().toISOString(),
        freshness: 'empty',
        riskScore: 0,
        riskLevel: 'LOW',
        hhiIndex: 0,
        hhiClassification: analytics.hhiClassification,
        topHoldingSymbol: null,
        topHoldingWeightPercent: null,
        sectorCount: 0,
        concentrationWarnings: [],
        holdingCount: 0,
        relevantEvents: [],
        priorityActions: ['Add holdings to get portfolio insights.'],
        narration: null,
        narrationFailed: false,
      };
    }

    // ── Risk primitives (deterministic) ─────────────────────────────
    const sortedByWeight = [...analytics.holdingWeights].sort(
      (a, b) => parseFloat(b.weightPercent) - parseFloat(a.weightPercent),
    );
    const topHolding = sortedByWeight[0];
    const topWeight = parseFloat(topHolding.weightPercent);
    const sectorCount = Object.keys(analytics.sectorAllocation).length;

    const concentrationPenalty =
      analytics.hhiIndex >= 2500 ? 35
      : analytics.hhiIndex >= 1500 ? 22
      : analytics.hhiIndex >= 1000 ? 12
      : 4;
    const topHoldingPenalty =
      topWeight >= 40 ? 20 : topWeight >= 25 ? 12 : topWeight >= 15 ? 6 : 0;
    const warningPenalty = Math.min(analytics.concentrationWarnings.length * 8, 20);
    const diversificationPenalty = sectorCount <= 2 ? 10 : 0;
    const riskScore = Math.min(
      100,
      Math.round(20 + concentrationPenalty + topHoldingPenalty + warningPenalty + diversificationPenalty),
    );

    // ── Event context (may fail gracefully) ─────────────────────────
    let relevantEvents: RelevantEvent[] = [];
    let eventsFailed = false;
    try {
      const topSymbols = sortedByWeight.slice(0, MAX_EVENT_HOLDINGS).map((h) => h.symbol);
      const newsResults = await Promise.allSettled(
        topSymbols.map((symbol) => this.newsAnalysisService.getRecentNews(symbol, NEWS_LOOKBACK_DAYS)),
      );

      // If ALL news fetches rejected, mark as degraded
      const allRejected = newsResults.length > 0 && newsResults.every((r) => r.status === 'rejected');
      if (allRejected) {
        eventsFailed = true;
      }

      for (let i = 0; i < newsResults.length; i++) {
        const result = newsResults[i];
        if (result.status === 'fulfilled' && !result.value.startsWith('No recent news')) {
          const parsed = this.parseNewsToEvents(result.value, topSymbols[i], sortedByWeight);
          relevantEvents.push(...parsed);
        }
      }

      // Sort by relevance: holding weight descending
      relevantEvents.sort((a, b) => {
        const weightA = this.getMaxWeight(a.impactedSymbols, sortedByWeight);
        const weightB = this.getMaxWeight(b.impactedSymbols, sortedByWeight);
        return weightB - weightA;
      });

      // Cap at 5 events
      relevantEvents = relevantEvents.slice(0, 5);
    } catch {
      eventsFailed = true;
      relevantEvents = [];
    }

    // ── Priority actions (deterministic) ─────────────────────────────
    const priorityActions = this.buildPriorityActions(analytics, sortedByWeight, sectorCount);

    // ── Narration (deterministic in Phase 1) ────────────────────────
    const narration = this.buildDeterministicNarration(
      topHolding, topWeight, sectorCount, analytics.hhiClassification, holdingCount, relevantEvents,
    );

    const freshness = eventsFailed ? 'degraded' : 'full';

    return {
      portfolioId,
      generatedAt: new Date().toISOString(),
      freshness,
      riskScore,
      riskLevel: this.toRiskLevel(riskScore),
      hhiIndex: analytics.hhiIndex,
      hhiClassification: analytics.hhiClassification,
      topHoldingSymbol: topHolding.symbol,
      topHoldingWeightPercent: topHolding.weightPercent,
      sectorCount,
      concentrationWarnings: analytics.concentrationWarnings,
      holdingCount,
      relevantEvents,
      priorityActions,
      narration,
      narrationFailed: false,
    };
  }

  private parseNewsToEvents(
    newsText: string,
    symbol: string,
    sortedByWeight: Array<{ symbol: string; weightPercent: string }>,
  ): RelevantEvent[] {
    const events: RelevantEvent[] = [];
    const articles = newsText.split(/\n\n+/);

    for (const article of articles) {
      const titleMatch = article.match(/\d+\.\s*\[(.+?)]\s*(.+)/);
      const publishedMatch = article.match(/Published:\s*(.+)/);
      if (!titleMatch) continue;

      const source = titleMatch[1];
      const headline = titleMatch[2].trim();
      const publishedAt = publishedMatch?.[1]?.trim() ?? new Date().toISOString();
      const weight = sortedByWeight.find((h) => h.symbol === symbol)?.weightPercent ?? '0';

      events.push({
        headline,
        source,
        publishedAt,
        impactedSymbols: [symbol],
        relevanceReason: `Impacts ${symbol} (${weight}% of portfolio)`,
      });
    }

    return events;
  }

  private getMaxWeight(
    symbols: string[],
    sortedByWeight: Array<{ symbol: string; weightPercent: string }>,
  ): number {
    let max = 0;
    for (const sym of symbols) {
      const holding = sortedByWeight.find((h) => h.symbol === sym);
      if (holding) {
        max = Math.max(max, parseFloat(holding.weightPercent));
      }
    }
    return max;
  }

  private buildPriorityActions(
    analytics: { concentrationWarnings: string[]; hhiIndex: number; hhiClassification: string },
    sortedByWeight: Array<{ symbol: string; weightPercent: string; sector: string }>,
    sectorCount: number,
  ): string[] {
    const actions: string[] = [];

    for (const warning of analytics.concentrationWarnings) {
      const symbolMatch = warning.match(/^(\w+)\s+represents/);
      if (symbolMatch) {
        actions.push(
          `Consider trimming ${symbolMatch[1]} to reduce single-stock concentration below 25%`,
        );
      }
    }

    if (sectorCount <= 2) {
      const existingSectors = new Set(sortedByWeight.map((h) => h.sector));
      actions.push(
        `Portfolio spans only ${sectorCount} sector(s) (${[...existingSectors].join(', ')}). Consider adding exposure to other sectors.`,
      );
    }

    if (analytics.hhiIndex >= 2500) {
      actions.push('Portfolio is highly concentrated. Consider rebalancing across more positions.');
    }

    if (actions.length === 0) {
      actions.push('Portfolio concentration is within acceptable thresholds. Continue monitoring.');
    }

    return actions;
  }

  private buildDeterministicNarration(
    topHolding: { symbol: string; companyName: string },
    topWeight: number,
    sectorCount: number,
    hhiClassification: string,
    holdingCount: number,
    events: RelevantEvent[],
  ): string {
    const parts: string[] = [];

    parts.push(
      `Your portfolio of ${holdingCount} holding(s) is classified as "${hhiClassification}" across ${sectorCount} sector(s).`,
    );

    if (topWeight > 25) {
      parts.push(
        `${topHolding.symbol} (${topHolding.companyName}) is your largest position at ${topWeight.toFixed(1)}%, which exceeds the 25% concentration threshold.`,
      );
    } else {
      parts.push(
        `${topHolding.symbol} (${topHolding.companyName}) is your largest position at ${topWeight.toFixed(1)}%.`,
      );
    }

    if (events.length > 0) {
      parts.push(`${events.length} recent event(s) may affect your holdings.`);
    } else {
      parts.push('No significant recent events were found for your holdings.');
    }

    return parts.join(' ');
  }

  private toRiskLevel(score: number): string {
    if (score >= 75) return 'HIGH';
    if (score >= 45) return 'MEDIUM';
    return 'LOW';
  }
}
