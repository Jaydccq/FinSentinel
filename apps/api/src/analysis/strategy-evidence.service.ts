import { Injectable } from '@nestjs/common';
import type {
  MarketBar,
  StrategyArchivePayload,
  StrategyRecommendedNextStep,
  StrategyTemplateEvaluation,
  StrategyTemplateKey,
} from '@finsentinel/shared';
import { strategyArchivePayloadSchema, strategyTemplateKeySchema } from '@finsentinel/shared';

import { MarketDataService } from '../market/market-data.service';
import { StrategyTemplateService } from '../market/strategy-template.service';

export interface BuildStrategyArchiveArgs {
  ticker?: string;
  requestedDays?: number;
  generatedAt?: Date;
}

const DEFAULT_REQUESTED_DAYS = 260;
const MARKET_DATA_SOURCE = 'market-data.service';
const EMPTY_MARKET_DATA_SOURCE = 'market-data.empty';
const MARKET_DATA_UNAVAILABLE_SOURCE = 'market-data.unavailable';
const NO_TICKER_SKIP_REASON = 'No ticker in run input.';
const NO_BARS_WARNING = 'Strategy evidence market data returned no bars.';
const MARKET_DATA_FAILURE_PREFIX = 'Strategy evidence market data failed: ';
const TEMPLATE_FAILURE_PREFIX = 'Strategy template evaluation failed for ';

const recommendationPriority: Record<StrategyRecommendedNextStep, number> = {
  REJECT: 0,
  PAPER_ONLY: 1,
  REVIEW_FOR_BACKTEST: 2,
};

@Injectable()
export class StrategyEvidenceService {
  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly strategyTemplateService: StrategyTemplateService,
  ) {}

  async buildArchive(args: BuildStrategyArchiveArgs): Promise<StrategyArchivePayload> {
    const requestedDays = args.requestedDays ?? DEFAULT_REQUESTED_DAYS;
    const generatedAt = (args.generatedAt ?? new Date()).toISOString();

    if (!args.ticker) {
      return strategyArchivePayloadSchema.parse({
        status: 'SKIPPED',
        generatedAt,
        bars: {
          requestedDays,
          receivedBars: 0,
          source: MARKET_DATA_SOURCE,
        },
        evaluations: [],
        selectedTemplateKey: null,
        summary: {
          enterLongCount: 0,
          blockedCount: 0,
          warnings: [NO_TICKER_SKIP_REASON],
          recommendedNextStep: null,
        },
        skipReason: NO_TICKER_SKIP_REASON,
      });
    }

    let marketBars: MarketBar[];
    try {
      marketBars = await this.marketDataService.getHistoricalBars(args.ticker, requestedDays);
    } catch (error) {
      return this.buildDegradedArchive({
        ticker: args.ticker,
        generatedAt,
        requestedDays,
        receivedBars: 0,
        source: MARKET_DATA_UNAVAILABLE_SOURCE,
        warning: `${MARKET_DATA_FAILURE_PREFIX}${this.describeError(error)}`,
      });
    }

    if (marketBars.length === 0) {
      return this.buildDegradedArchive({
        ticker: args.ticker,
        generatedAt,
        requestedDays,
        receivedBars: 0,
        source: EMPTY_MARKET_DATA_SOURCE,
        warning: NO_BARS_WARNING,
      });
    }

    try {
      const numericBars = marketBars.map((bar) => this.toNumericBar(bar));

      return this.evaluateTemplates({
        ticker: args.ticker,
        generatedAt,
        requestedDays,
        marketBars,
        numericBars,
      });
    } catch (error) {
      return this.buildDegradedArchive({
        ticker: args.ticker,
        generatedAt,
        requestedDays,
        receivedBars: 0,
        source: MARKET_DATA_UNAVAILABLE_SOURCE,
        warning: `${MARKET_DATA_FAILURE_PREFIX}${this.describeError(error)}`,
      });
    }
  }

  private toNumericBar(bar: MarketBar): {
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    t: number;
  } {
    return {
      o: this.parseFiniteNumericString(bar.open, 'open'),
      h: this.parseFiniteNumericString(bar.high, 'high'),
      l: this.parseFiniteNumericString(bar.low, 'low'),
      c: this.parseFiniteNumericString(bar.close, 'close'),
      v: this.parseFiniteNumber(bar.volume, 'volume'),
      t: this.parseFiniteNumber(bar.timestamp, 'timestamp'),
    };
  }

  private evaluateTemplates(args: {
    ticker: string;
    generatedAt: string;
    requestedDays: number;
    marketBars: MarketBar[];
    numericBars: Array<{
      o: number;
      h: number;
      l: number;
      c: number;
      v: number;
      t: number;
    }>;
  }): StrategyArchivePayload {
    const barsJson = JSON.stringify(args.numericBars);
    const evaluations: StrategyTemplateEvaluation[] = [];
    const warnings: string[] = [];
    let enterLongCount = 0;
    let blockedCount = 0;
    let selectedTemplateKey: StrategyTemplateKey | null = null;
    let selectedRecommendedNextStep: StrategyRecommendedNextStep | null = null;
    let selectedPriority = 0;
    let selectedConfidence = Number.NEGATIVE_INFINITY;
    let degraded = false;

    for (const templateKey of strategyTemplateKeySchema.options) {
      try {
        const evaluation = this.strategyTemplateService.evaluate({
          barsJson,
          templateKey,
        });

        evaluations.push(evaluation);
        enterLongCount += evaluation.signal === 'ENTER_LONG' ? 1 : 0;
        blockedCount += evaluation.signal === 'BLOCKED' ? 1 : 0;
        this.appendWarnings(warnings, evaluation.warnings);

        const priority = recommendationPriority[evaluation.recommendedNextStep];
        const shouldSelect =
          priority > 0 &&
          (priority > selectedPriority ||
            (priority === selectedPriority && evaluation.confidence > selectedConfidence));

        if (shouldSelect) {
          selectedTemplateKey = templateKey;
          selectedRecommendedNextStep = evaluation.recommendedNextStep;
          selectedPriority = priority;
          selectedConfidence = evaluation.confidence;
        }
      } catch (error) {
        degraded = true;
        warnings.push(`${TEMPLATE_FAILURE_PREFIX}${templateKey}: ${this.describeError(error)}`);
      }
    }

    return strategyArchivePayloadSchema.parse({
      status: degraded ? 'DEGRADED' : 'EVALUATED',
      ticker: args.ticker,
      generatedAt: args.generatedAt,
      bars: {
        requestedDays: args.requestedDays,
        receivedBars: args.marketBars.length,
        source: MARKET_DATA_SOURCE,
      },
      evaluations,
      selectedTemplateKey,
      summary: {
        enterLongCount,
        blockedCount,
        warnings,
        recommendedNextStep: selectedRecommendedNextStep,
      },
    });
  }

  private buildDegradedArchive(args: {
    ticker: string;
    generatedAt: string;
    requestedDays: number;
    receivedBars: number;
    source: string;
    warning: string;
  }): StrategyArchivePayload {
    return strategyArchivePayloadSchema.parse({
      status: 'DEGRADED',
      ticker: args.ticker,
      generatedAt: args.generatedAt,
      bars: {
        requestedDays: args.requestedDays,
        receivedBars: args.receivedBars,
        source: args.source,
      },
      evaluations: [],
      selectedTemplateKey: null,
      summary: {
        enterLongCount: 0,
        blockedCount: 0,
        warnings: [args.warning],
        recommendedNextStep: null,
      },
    });
  }

  private parseFiniteNumericString(value: string, field: string): number {
    if (typeof value !== 'string') {
      throw new Error(`Invalid market bar field ${field}.`);
    }

    const trimmedValue = value.trim();
    if (trimmedValue === '') {
      throw new Error(`Invalid market bar field ${field}.`);
    }

    const parsedValue = Number(trimmedValue);
    if (!Number.isFinite(parsedValue)) {
      throw new Error(`Invalid market bar field ${field}.`);
    }

    return parsedValue;
  }

  private parseFiniteNumber(value: number, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Invalid market bar field ${field}.`);
    }

    return value;
  }

  private appendWarnings(target: string[], warnings: string[]): void {
    for (const warning of warnings) {
      if (!target.includes(warning)) {
        target.push(warning);
      }
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error);
  }
}
